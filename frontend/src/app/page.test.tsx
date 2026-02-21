import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import VoiceWorkspace from './page';

// jsdom does not implement scrollIntoView
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('VoiceWorkspace', () => {
  it('renders without crashing and displays the main heading', () => {
    render(<VoiceWorkspace />);
    expect(screen.getByText('Voice Workspace')).toBeDefined();
  });

  it('displays the SIP method selector with INVITE default', () => {
    render(<VoiceWorkspace />);
    expect(screen.getAllByDisplayValue('INVITE').length).toBeGreaterThan(0);
  });

  it('displays the URI input with default value', () => {
    render(<VoiceWorkspace />);
    expect(screen.getAllByDisplayValue('sip:agent@example.com').length).toBeGreaterThan(0);
  });

  it('displays response tabs', () => {
    render(<VoiceWorkspace />);
    expect(screen.getAllByText('SIP Timeline').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Diagnostics').length).toBeGreaterThan(0);
  });

  it('displays config tabs', () => {
    render(<VoiceWorkspace />);
    expect(screen.getAllByText('Headers').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Auth').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Audio').length).toBeGreaterThan(0);
  });
});
