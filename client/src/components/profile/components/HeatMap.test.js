/* global expect jest */

import '@testing-library/jest-dom/extend-expect';
import React from 'react';
import { render } from '@testing-library/react';

import HeatMap from './HeatMap';

// offset is used to shift the dates so that the calendar renders (for testing
// purposes only) the same way in each timezone.
const offset = new Date().getTimezoneOffset() * 60;
const date1 = 1580497504 + offset;
const date2 = 1580597504 + offset;
const date3 = 1580729769 + offset;

const props = {
  calendar: {}
};

props.calendar[date1] = 1;
props.calendar[date2] = 1;
props.calendar[date3] = 1;

let dateNowMockFn;

beforeEach(() => {
  dateNowMockFn = jest
    .spyOn(Date, 'now')
    .mockImplementation(() => 1580729769714 + offset * 1000);
});

afterEach(() => {
  dateNowMockFn.mockRestore();
});

describe('<HeatMap/>', () => {
  it('renders correctly', () => {
    const { container } = render(<HeatMap {...props} />);
    expect(container).toMatchSnapshot();
  });

  it('calculates the correct longest streak', () => {
    const { getByTestId } = render(<HeatMap {...props} />);
    expect(getByTestId('longest-streak').textContent).toContain(
      'Longest Streak: 2'
    );
  });

  it('calculates the correct current streak', () => {
    const { getByTestId } = render(<HeatMap {...props} />);
    expect(getByTestId('current-streak').textContent).toContain(
      'Current Streak: 1'
    );
  });
});
