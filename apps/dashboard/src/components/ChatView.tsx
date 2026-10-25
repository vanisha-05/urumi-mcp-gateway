import React, { useState, useEffect, useRef } from 'react';
import { User, sendChatMessage, fetchAggregatedTools, ToolDef } from '../api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: Array<{
    name: string;
    upstream: string;
    args: unknown;
    result: unknown;
  }>;
}

interface ChatViewProps {
  user: User | null;
  onOpenAuthModal?: () => void;
}

function getToolIdentifier(name: string): string {
  return name.replace(/^[0-9a-f]{8}-[0-9a-f-]{27}__/i, '').split('__').pop() || name;
}

function getToolLabel(name: string): string {
  return getToolIdentifier(name)
    .replace(/^(get|fetch|check|list)_/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, character => character.toUpperCase());
}

export function ChatView({ user, onOpenAuthModal }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'init-1',
      role: 'assistant',
      content:
        'Hello! I am your Team MCP Agent. I can manage WooCommerce products and orders, check inventory stock, and run system utilities through the Urumi Gateway.\n\nAll actions run through the team gateway and are attributed to your identity in the audit log.',
      timestamp: Date.now(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [availableTools, setAvailableTools] = useState<ToolDef[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (user) {
      setToolsLoading(true);
      setToolsError(null);
      fetchAggregatedTools()
        .then(res => setAvailableTools(res.tools || []))
        .catch(err => {
          setAvailableTools([]);
          setToolsError(err instanceof Error ? err.message : 'Tool discovery failed.');
        })
        .finally(() => setToolsLoading(false));
    } else {
      setAvailableTools([]);
      setToolsError(null);
    }
  }, [user]);

  const handleSendMessage = async (text?: string) => {
    const content = (text ?? inputValue).trim();
    if (!content || isLoading) return;

    if (!user) {
      onOpenAuthModal?.();
      return;
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    if (!text) setInputValue('');
    setIsLoading(true);

    try {
      // Build conversation history for gateway
      const historyPayload = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await sendChatMessage(historyPayload);

      const assistantMsg: ChatMessage = {
        id: `msg-res-${Date.now()}`,
        role: 'assistant',
        content: res.content || 'Action executed successfully.',
        timestamp: Date.now(),
        toolCalls: res.toolCalls,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages(prev => [
        ...prev,
        {
          id: `msg-err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ Error executing request: ${errMsg}\n\nPlease verify that your API key has appropriate permissions and the upstream servers are reachable.`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const quickPrompts = [
    {
      label: 'Create Product',
      prompt: 'Create a product named "Space Gray Pro Earbuds" with price "249"',
      badge: 'WooCommerce',
    },
    {
      label: 'Query Today’s Orders',
      prompt: 'What orders came in today?',
      badge: 'WooCommerce',
    },
    {
      label: 'Check Inventory',
      prompt: 'Check stock inventory for SKU-100',
      badge: 'Inventory',
    },
    {
      label: 'System Status',
      prompt: 'Check system health and uptime',
      badge: 'System',
    },
  ];

  return (
    <div className="apple-chat-view-container">
      {/* Top Banner & Context Info */}
      <div className="apple-chat-header">
        <div className="apple-chat-header-left">
          <div className="apple-chat-status-indicator">
            <span className="apple-chat-title">Team MCP Agent</span>
            <span className="apple-chat-version-pill">Gateway v1.0</span>
          </div>
          <p className="apple-chat-subtitle">
            Autonomous tool orchestration across WooCommerce, Warehouse Inventory, and System Utilities.
          </p>
        </div>

        <div className="apple-chat-header-right">
          {user ? (
            <div className="apple-chat-user-badge">
              <span className="apple-user-role-tag">{user.role}</span>
              <span className="apple-user-name">{user.username}</span>
              <span className="apple-tool-count-badge">
                {toolsLoading
                  ? 'Loading tools…'
                  : toolsError
                    ? 'Tool discovery unavailable'
                    : `${availableTools.length} tools available`}
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="apple-chat-auth-prompt-btn"
              onClick={onOpenAuthModal}
            >
              Authenticate with API Key
            </button>
          )}
        </div>
      </div>

      {/* Available Tools Ribbon */}
      {user && availableTools.length > 0 && (
        <div className="apple-tools-ribbon">
          <span className="apple-tools-ribbon-label">Active Gateway Capabilities:</span>
          <div className="apple-tools-chips-scroller">
            {availableTools.map(t => (
              <span
                key={t.name}
                className="apple-tool-chip"
                title={`${t._upstreamName || 'Upstream'}: ${t.description || t.name}`}
              >
                <span className="apple-tool-chip-prefix">{t._upstreamName || 'mcp'}</span>
                {getToolLabel(t._originalName || t.name)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Message Thread */}
      <div className="apple-chat-messages-scroll">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`apple-chat-message-row ${msg.role === 'user' ? 'user-row' : 'assistant-row'}`}
          >
            <div className="apple-chat-avatar">
              {msg.role === 'user' ? (
                <span>{(user?.username?.[0] || 'U').toUpperCase()}</span>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM7.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />
                </svg>
              )}
            </div>

            <div className={`apple-chat-message-bubble ${msg.id.startsWith('msg-err-') ? 'error-bubble' : ''}`}>
              <div className="apple-chat-message-header">
                <span className="apple-chat-sender-name">
                  {msg.role === 'user' ? (user?.username || 'You') : 'Team Gateway Agent'}
                </span>
                <span className="apple-chat-timestamp">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Tool Calls Execution Details if any */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="apple-tool-executions-box">
                  <div className="apple-tool-executions-header">
                    <span className="apple-tool-icon" aria-hidden="true">⚡</span>
                    <span>Executed {msg.toolCalls.length} MCP Gateway Tool{msg.toolCalls.length > 1 ? 's' : ''}</span>
                  </div>
                  <div className="apple-tool-calls-list">
                    {msg.toolCalls.map((tc, idx) => {
                      const callKey = `${msg.id}-tc-${idx}`;
                      const isExpanded = expandedToolId === callKey;
                      return (
                        <div key={callKey} className="apple-tool-call-card">
                          <button
                            type="button"
                            className="apple-tool-call-summary"
                            onClick={() => setExpandedToolId(isExpanded ? null : callKey)}
                            aria-expanded={isExpanded}
                          >
                            <span className="apple-tool-status-check" aria-hidden="true">•</span>
                            <span className="apple-tool-upstream-tag">{tc.upstream}</span>
                            <span className="apple-tool-name-code">{getToolLabel(tc.name)}</span>
                            <code className="apple-tool-id-code">{getToolIdentifier(tc.name)}</code>
                            <span className="apple-tool-toggle-icon">{isExpanded ? '▲' : '▼'}</span>
                          </button>

                          {isExpanded && (
                            <div className="apple-tool-call-details">
                              <div className="apple-tool-detail-section">
                                <div className="apple-tool-detail-label">Arguments:</div>
                                <pre className="apple-tool-code-block">
                                  {JSON.stringify(tc.args, null, 2)}
                                </pre>
                              </div>
                              <div className="apple-tool-detail-section">
                                <div className="apple-tool-detail-label">Gateway Result:</div>
                                <pre className="apple-tool-code-block">
                                  {typeof tc.result === 'string'
                                    ? tc.result
                                    : JSON.stringify(tc.result, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Message Text Content */}
              <div className="apple-chat-text-content">
                {msg.content.split('\n\n').map((paragraph, pIdx) => (
                  <p key={pIdx}>{paragraph}</p>
                ))}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="apple-chat-message-row assistant-row">
            <div className="apple-chat-avatar">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zM7.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />
              </svg>
            </div>
            <div className="apple-chat-message-bubble loading-bubble">
              <div className="apple-typing-indicator">
                <span />
                <span />
                <span />
              </div>
              <span className="apple-loading-label">Connecting to upstream MCP servers...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Panel */}
      <div className="apple-chat-quick-prompts">
        <span className="apple-quick-prompts-label">Quick actions:</span>
        <div className="apple-quick-prompts-row">
          {quickPrompts.map((qp, qIdx) => (
            <button
              key={qIdx}
              type="button"
              className="apple-quick-prompt-btn"
              disabled={isLoading}
              onClick={() => handleSendMessage(qp.prompt)}
            >
              <span className="apple-qp-badge">{qp.badge}</span>
              <span className="apple-qp-label">{qp.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input Composer */}
      <div className="apple-chat-input-wrapper">
        <textarea
          className="apple-chat-textarea"
          placeholder={
            user
              ? 'Ask the agent to create a product, query orders, inspect inventory, or check health...'
              : 'Please authenticate with an API key to send messages.'
          }
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading || !user}
          rows={2}
        />

        <div className="apple-chat-input-actions">
          <span className="apple-chat-hint">Press Enter to send, Shift+Enter for newline</span>
          <button
            type="button"
            className="apple-chat-send-btn"
            disabled={isLoading || !inputValue.trim() || !user}
            onClick={() => handleSendMessage()}
          >
            {isLoading ? (
              <span className="apple-send-spinner" />
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
            <span>Send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
