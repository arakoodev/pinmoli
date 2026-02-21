import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VoiceWorkspace from './page';

describe('VoiceWorkspace', () => {
  it('renders without crashing and displays the main heading', () => {
    render(<VoiceWorkspace />);
    expect(screen.getByText('Voice Workspace')).toBeDefined();
  });

  it('displays default sip target input value', () => {
    render(<VoiceWorkspace />);
    expect(screen.getAllByDisplayValue('sip:agent@livekit.cloud').length).toBeGreaterThan(0);
  });
});
