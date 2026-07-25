import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App.js';
import { useStore } from '../store.js';

describe('App rendered shell', () => {
  beforeEach(() => {
    useStore.setState({ loading: true, activeTab: 'overview' });
  });

  it('renders the real loading state in a DOM', () => {
    render(<App />);

    expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();
  });
});
