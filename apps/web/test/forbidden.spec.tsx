import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ForbiddenPage } from '../src/pages/forbidden';

describe('Forbidden page', () => {
  it('shows a separate 403 state', () => {
    render(
      <MemoryRouter>
        <ForbiddenPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Accès interdit' })).toBeInTheDocument();
  });
});
