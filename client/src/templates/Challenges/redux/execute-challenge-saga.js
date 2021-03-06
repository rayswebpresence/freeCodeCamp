import {
  delay,
  put,
  select,
  call,
  takeLatest,
  takeEvery,
  fork,
  getContext,
  take,
  cancel
} from 'redux-saga/effects';
import { channel } from 'redux-saga';
import escape from 'lodash/escape';

import {
  challengeDataSelector,
  challengeMetaSelector,
  challengeTestsSelector,
  initConsole,
  updateConsole,
  initLogs,
  updateLogs,
  logsToConsole,
  updateTests,
  isBuildEnabledSelector,
  disableBuildOnError,
  types
} from './';

import {
  buildChallenge,
  canBuildChallenge,
  getTestRunner,
  challengeHasPreview,
  updatePreview,
  isJavaScriptChallenge,
  isLoopProtected
} from '../utils/build';

// How long before bailing out of a preview.
const previewTimeout = 2500;

export function* executeCancellableChallengeSaga() {
  const task = yield fork(executeChallengeSaga);

  yield take(types.cancelTests);
  yield cancel(task);
}

export function* executeChallengeSaga() {
  const isBuildEnabled = yield select(isBuildEnabledSelector);
  if (!isBuildEnabled) {
    return;
  }

  const consoleProxy = yield channel();

  try {
    yield put(initLogs());
    yield put(initConsole('// running tests'));
    // reset tests to initial state
    const tests = (yield select(challengeTestsSelector)).map(
      ({ text, testString }) => ({ text, testString })
    );
    yield put(updateTests(tests));

    yield fork(takeEveryLog, consoleProxy);
    const proxyLogger = args => consoleProxy.put(args);

    const challengeData = yield select(challengeDataSelector);
    const challengeMeta = yield select(challengeMetaSelector);
    const protect = isLoopProtected(challengeMeta);
    const buildData = yield buildChallengeData(challengeData, {
      preview: false,
      protect
    });
    const document = yield getContext('document');
    const testRunner = yield call(
      getTestRunner,
      buildData,
      { proxyLogger },
      document
    );
    const testResults = yield executeTests(testRunner, tests);

    yield put(updateTests(testResults));
    yield put(updateConsole('// tests completed'));
    yield put(logsToConsole('// console output'));
  } catch (e) {
    yield put(updateConsole(e));
  } finally {
    consoleProxy.close();
  }
}

function* takeEveryLog(channel) {
  // TODO: move all stringifying and escaping into the reducer so there is a
  // single place responsible for formatting the logs.
  yield takeEvery(channel, function*(args) {
    yield put(updateLogs(escape(args)));
  });
}

function* takeEveryConsole(channel) {
  // TODO: move all stringifying and escaping into the reducer so there is a
  // single place responsible for formatting the console output.
  yield takeEvery(channel, function*(args) {
    yield put(updateConsole(escape(args)));
  });
}

function* buildChallengeData(challengeData, options) {
  try {
    return yield call(buildChallenge, challengeData, options);
  } catch (e) {
    yield put(disableBuildOnError());
    throw e;
  }
}

function* executeTests(testRunner, tests, testTimeout = 5000) {
  const testResults = [];
  for (let i = 0; i < tests.length; i++) {
    const { text, testString } = tests[i];
    const newTest = { text, testString };
    // only the last test outputs console.logs to avoid log duplication.
    const firstTest = i === 1;
    try {
      const { pass, err } = yield call(
        testRunner,
        testString,
        testTimeout,
        firstTest
      );
      if (pass) {
        newTest.pass = true;
      } else {
        throw err;
      }
    } catch (err) {
      newTest.message = text;
      if (err === 'timeout') {
        newTest.err = 'Test timed out';
        newTest.message = `${newTest.message} (${newTest.err})`;
      } else {
        const { message, stack } = err;
        newTest.err = message + '\n' + stack;
        newTest.stack = stack;
      }
      yield put(updateConsole(newTest.message));
    } finally {
      testResults.push(newTest);
    }
  }
  return testResults;
}

// updates preview frame and the fcc console.
function* previewChallengeSaga() {
  yield delay(700);

  const isBuildEnabled = yield select(isBuildEnabledSelector);
  if (!isBuildEnabled) {
    return;
  }

  const logProxy = yield channel();
  const proxyLogger = args => logProxy.put(args);

  try {
    yield put(initLogs());
    yield put(initConsole(''));
    yield fork(takeEveryConsole, logProxy);

    const challengeData = yield select(challengeDataSelector);

    if (canBuildChallenge(challengeData)) {
      const challengeMeta = yield select(challengeMetaSelector);
      const protect = isLoopProtected(challengeMeta);
      const buildData = yield buildChallengeData(challengeData, {
        preview: true,
        protect
      });
      // evaluate the user code in the preview frame or in the worker
      if (challengeHasPreview(challengeData)) {
        const document = yield getContext('document');
        yield call(updatePreview, buildData, document, proxyLogger);
      } else if (isJavaScriptChallenge(challengeData)) {
        const runUserCode = getTestRunner(buildData, { proxyLogger });
        // without a testString the testRunner just evaluates the user's code
        yield call(runUserCode, null, previewTimeout);
      }
    }
  } catch (err) {
    if (err === 'timeout') {
      // eslint-disable-next-line no-ex-assign
      err = `The code you have written is taking longer than the ${previewTimeout}ms our challenges allow. You may have created an infinite loop or need to write a more efficient algorithm`;
    }
    console.log(err);
    yield put(updateConsole(escape(err)));
  }
}

export function createExecuteChallengeSaga(types) {
  return [
    takeLatest(types.executeChallenge, executeCancellableChallengeSaga),
    takeLatest(
      [
        types.updateFile,
        types.previewMounted,
        types.challengeMounted,
        types.resetChallenge
      ],
      previewChallengeSaga
    )
  ];
}
