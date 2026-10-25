import React, { useState } from 'react';
import { verifyApiKey, User } from '../api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [keyInput, setKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = keyInput.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const res = await verifyApiKey(trimmed);
      onSuccess(res.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please check that your key is valid and the gateway is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="apple-modal-overlay" onClick={onClose}>
      <div className="apple-modal-card auth-modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="auth-modal-title-row">
            <div className="auth-lock-circle">🔒</div>
            <h2>Authenticate Operator</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <p className="auth-modal-desc">
          Authorize this session with your Urumi Gateway API Key to access administrative routes, orders, and private tools.
        </p>

        {error && <div className="login-error-alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Admin or Member API Key</label>
            <input
              type="password"
              required
              className="apple-form-input font-mono"
              placeholder="urumi_..."
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              autoFocus
            />
          </div>

          <div className="modal-actions-footer">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button button-wide"
              disabled={loading}
            >
              <span>{loading ? 'Verifying...' : 'Verify Key'}</span>
            </button>
          </div>
        </form>

        <div className="auth-modal-tip">
          <span>Tip:</span> Generate an admin key in terminal with:
          <code>npm run provision:admin</code>
        </div>
      </div>
    </div>
  );
}
