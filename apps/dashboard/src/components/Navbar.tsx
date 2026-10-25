import React, { useState } from 'react';
import { User } from '../api';

interface NavbarProps {
  activeTab: 'account' | 'sample' | 'tools' | 'chat';
  setActiveTab: (tab: 'account' | 'sample' | 'tools' | 'chat') => void;
  cartCount: number;
  user: User | null;
  onOpenAuthModal: () => void;
  onLogout: () => void;
}

export function Navbar({
  activeTab,
  setActiveTab,
  cartCount,
  user,
  onOpenAuthModal,
  onLogout,
}: NavbarProps) {
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  return (
    <header className="apple-navbar">
      <div className="apple-navbar-container">
        {/* Flip Urumi Logo */}
        <div
          className="urumi-logo-container"
          onClick={() => setActiveTab('sample')}
          title="Urumi Gateway dashboard"
        >
          <div className="urumi-logo-inner">
            <div className="urumi-logo-front">
              <svg className="urumi-logo-symbol" viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="urumi-logo-text">urumi</span>
            </div>
            <div className="urumi-logo-back">
              <span className="urumi-badge-glow">MCP✦PRO</span>
            </div>
          </div>
        </div>

        {/* Navigation Elements from the Image */}
        <nav className="apple-nav-links">
          <button
            type="button"
            className={`apple-nav-link ${activeTab === 'sample' ? 'active' : ''}`}
            onClick={() => setActiveTab('sample')}
          >
            Gateway
          </button>

          <button
            type="button"
            className={`apple-nav-link ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            Agent Chat
          </button>

          <button
            type="button"
            className={`apple-nav-link ${activeTab === 'account' ? 'active' : ''}`}
            onClick={() => setActiveTab('account')}
          >
            My account
            {user && <span className="auth-indicator-dot" title={`Signed in as ${user.username}`} />}
          </button>

          <button
            type="button"
            className={`apple-nav-link ${activeTab === 'tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            Tools
          </button>

          {/* User Icon from Picture */}
          <div className="apple-user-menu-wrapper">
            <button
              type="button"
              className={`apple-user-icon-btn ${user ? 'authenticated' : ''}`}
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              title={user ? `Signed in as ${user.username} (${user.role})` : 'Account & Authentication'}
              aria-label="User Account"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" className="user-nav-svg">
                <path
                  d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle
                  cx="12"
                  cy="7"
                  r="4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {/* Quick User Dropdown */}
            {showUserDropdown && (
              <div className="apple-dropdown-menu">
                {user ? (
                  <>
                    <div className="apple-dropdown-header">
                      <div className="apple-user-name">{user.username}</div>
                      <div className="apple-user-role-pill">{user.role.toUpperCase()}</div>
                    </div>
                    <button
                      className="apple-dropdown-item"
                      onClick={() => {
                        setActiveTab('account');
                        setShowUserDropdown(false);
                      }}
                    >
                      Account Settings & API Keys
                    </button>
                    <div className="apple-dropdown-divider" />
                    <button
                      className="apple-dropdown-item text-danger"
                      onClick={() => {
                        onLogout();
                        setShowUserDropdown(false);
                      }}
                    >
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <div className="apple-dropdown-header">
                      <div className="apple-user-name">Guest Operator</div>
                      <div className="apple-user-role-pill guest">UNAUTHORIZED</div>
                    </div>
                    <button
                      className="apple-dropdown-item highlight"
                      onClick={() => {
                        onOpenAuthModal();
                        setShowUserDropdown(false);
                      }}
                    >
                      Verify Admin API Key
                    </button>
                    <button
                      className="apple-dropdown-item"
                      onClick={() => {
                        setActiveTab('account');
                        setShowUserDropdown(false);
                      }}
                    >
                      Go to My Account
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
