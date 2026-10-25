import React, { useState, useEffect } from 'react';
import { User, clearLegacyStoredApiKey, fetchSession, logoutSession } from './api';
import { AsciiBackground } from './components/AsciiBackground';
import { Navbar } from './components/Navbar';
import { MyAccountView } from './components/MyAccountView';
import { SamplePageView } from './components/SamplePageView';
import { ChatView } from './components/ChatView';
import { AuthModal } from './components/AuthModal';

export function App() {
  const [activeTab, setActiveTab] = useState<'sample' | 'tools' | 'account' | 'chat'>('sample');

  const [user, setUser] = useState<User | null>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Restore the server-managed session on launch.
  useEffect(() => {
    clearLegacyStoredApiKey();
    fetchSession().then(res => setUser(res.user)).catch(() => setUser(null));
  }, []);

  return (
    <div className={`apple-app-root ${activeTab === 'chat' ? 'chat-app-root' : ''}`}>
      {/* 1. ASCII Background with '+' sign pixels */}
      <AsciiBackground />

      {/* 2. Cursor Trail using SalladShooter figureEight loader in Black & White */}
      {/* 3. Navigation Bar matching user's image & flipping logo */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        cartCount={0}
        user={user}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onLogout={() => {
          void logoutSession().catch(() => undefined).finally(() => setUser(null));
        }}
      />

      {/* 4. Main Body Content */}
      <main className={`apple-main-content ${activeTab === 'chat' ? 'chat-main-content' : ''}`}>
        {activeTab === 'chat' && (
          <ChatView
            user={user}
            onOpenAuthModal={() => setIsAuthModalOpen(true)}
          />
        )}

        {activeTab === 'account' && (
          <MyAccountView
            user={user}
            onUserChange={setUser}
            orders={[]}
          />
        )}

        {(activeTab === 'sample' || activeTab === 'tools') && <SamplePageView user={user} />}
      </main>

      {activeTab !== 'chat' && (
        <footer className="apple-footer">
          <div className="apple-footer-inner">
            <div className="footer-notes">
              <p>
                1. Urumi Model Context Protocol Gateway acts as a high-throughput proxy between client LLMs and distributed upstream servers.
              </p>
              <p>Manage MCP servers and run permitted tools through one authenticated gateway.</p>
            </div>

            <div className="footer-divider" />

            <div className="footer-bottom-row">
              <div className="footer-copyright">
                Copyright © 2026 Urumi MCP Project. All rights reserved.
              </div>

              <div className="footer-links">
                <button className="footer-link-btn" onClick={() => setActiveTab('sample')}>Gateway</button>
                <button className="footer-link-btn" onClick={() => setActiveTab('chat')}>Agent Chat</button>
                <button className="footer-link-btn" onClick={() => setActiveTab('sample')}>Architecture</button>
                <button className="footer-link-btn" onClick={() => setActiveTab('account')}>API Credentials</button>
                <a className="footer-link-btn" href="/">WooCommerce Store</a>
              </div>
            </div>
          </div>
        </footer>
      )}

      {/* 6. Quick Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={authedUser => {
          setUser(authedUser);
          setIsAuthModalOpen(false);
        }}
      />
    </div>
  );
}

export default App;
