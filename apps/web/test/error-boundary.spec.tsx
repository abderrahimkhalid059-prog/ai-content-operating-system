import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/error-boundary';

function Broken(): never {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  it('shows a recoverable French fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Une erreur est survenue');
  });
});
