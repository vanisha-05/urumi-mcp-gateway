import React, { useState, useEffect } from 'react';
import {
  User,
  ApiKeyItem,
  AuditLogItem,
  UpstreamServer,
  ToolDef,
  verifyApiKey,
  logoutSession,
  fetchMyKeys,
  createMyKey,
  revokeMyKey,
  fetchUpstreams,
  createUpstream,
  updateUpstream,
  deleteUpstream,
  toggleUpstream,
  fetchAggregatedTools,
  fetchUsers,
  createUser,
  fetchUserKeysAdmin,
  createKeyForUserAdmin,
  revokeKeyAdmin,
  fetchAuditLogs,
} from '../api';
import { Order } from '../types';

interface MyAccountViewProps {
  user: User | null;
  onUserChange: (user: User | null) => void;
  orders: Order[];
}

export function MyAccountView({ user, onUserChange, orders }: MyAccountViewProps) {
  // Login State
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Account Sub-tab
  const [subTab, setSubTab] = useState<'keys' | 'orders' | 'upstreams' | 'users' | 'audit'>('keys');

  // Keys state
  const [myKeys, setMyKeys] = useState<ApiKeyItem[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedPlaintextKey, setGeneratedPlaintextKey] = useState<string | null>(null);
  const [keysLoading, setKeysLoading] = useState(false);
  const [showGenModal, setShowGenModal] = useState(false);

  // Admin states
  const [upstreams, setUpstreams] = useState<UpstreamServer[]>([]);
  const [upstreamTools, setUpstreamTools] = useState<ToolDef[]>([]);
  const [upstreamsLoading, setUpstreamsLoading] = useState(false);
  const [upstreamsError, setUpstreamsError] = useState<string | null>(null);
  const [upstreamFormOpen, setUpstreamFormOpen] = useState(false);
  const [editingUpstream, setEditingUpstream] = useState<UpstreamServer | null>(null);
  const [upstreamName, setUpstreamName] = useState('');
  const [upstreamUrl, setUpstreamUrl] = useState('');
  const [upstreamCredentialType, setUpstreamCredentialType] = useState<'none' | 'header' | 'bearer'>('none');
  const [upstreamCredentialKey, setUpstreamCredentialKey] = useState('');
  const [upstreamCredentialValue, setUpstreamCredentialValue] = useState('');
  const [clearUpstreamCredential, setClearUpstreamCredential] = useState(false);
  const [upstreamSaving, setUpstreamSaving] = useState(false);
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const [memberKeys, setMemberKeys] = useState<Record<string, ApiKeyItem[]>>({});
  const [memberKeysOpen, setMemberKeysOpen] = useState<Record<string, boolean>>({});
  const [memberKeyBusy, setMemberKeyBusy] = useState<string | null>(null);
  const [issuedMemberKey, setIssuedMemberKey] = useState<{ username: string; key: string } | null>(null);
  const [memberKeyName, setMemberKeyName] = useState('');

  // Load account data when user is present
  useEffect(() => {
    if (user) {
      loadKeys();
      if (user.role === 'admin') {
        loadAdminData();
        loadUpstreams();
      }
    }
  }, [user]);

  const loadKeys = async () => {
    setKeysLoading(true);
    try {
      const keys = await fetchMyKeys();
      setMyKeys(keys);
    } catch {
      // ignore
    } finally {
      setKeysLoading(false);
    }
  };

  const loadAdminData = async () => {
    try {
      const [members, audit] = await Promise.all([
        fetchUsers().catch(() => []),
        fetchAuditLogs(100).catch(() => []),
      ]);
      setTeamUsers(members);
      setAuditLogs(audit);
    } catch {
      // ignore
    }
  };

  const loadUpstreams = async () => {
    setUpstreamsLoading(true);
    setUpstreamsError(null);
    try {
      const [servers, toolsResult] = await Promise.all([
        fetchUpstreams(),
        fetchAggregatedTools(),
      ]);
      setUpstreams(servers);
      setUpstreamTools(toolsResult.tools || []);
    } catch (err) {
      setUpstreamsError(err instanceof Error ? err.message : 'Failed to load upstream servers.');
    } finally {
      setUpstreamsLoading(false);
    }
  };

  const openUpstreamForm = (upstream?: UpstreamServer) => {
    setEditingUpstream(upstream || null);
    setUpstreamName(upstream?.name || '');
    setUpstreamUrl(upstream?.url || '');
    setUpstreamCredentialType(upstream?.credential_type || 'none');
    setUpstreamCredentialKey(upstream?.credential_key || '');
    setUpstreamCredentialValue('');
    setClearUpstreamCredential(false);
    setUpstreamFormOpen(true);
  };

  const closeUpstreamForm = () => {
    if (upstreamSaving) return;
    setUpstreamFormOpen(false);
    setEditingUpstream(null);
    setUpstreamCredentialValue('');
  };

  const handleSaveUpstream = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpstreamSaving(true);
    setUpstreamsError(null);
    try {
      const baseData = { name: upstreamName.trim(), url: upstreamUrl.trim() };
      if (editingUpstream) {
        const data: Parameters<typeof updateUpstream>[1] = baseData;
        if (upstreamCredentialType === 'none') {
          data.credential_type = null;
          data.credential_key = null;
          if (editingUpstream.has_credential || clearUpstreamCredential) data.credential_value = null;
        } else {
          data.credential_type = upstreamCredentialType;
          data.credential_key = upstreamCredentialType === 'header' ? upstreamCredentialKey.trim() || null : null;
          if (upstreamCredentialValue) data.credential_value = upstreamCredentialValue;
          else if (clearUpstreamCredential) data.credential_value = null;
        }
        await updateUpstream(editingUpstream.id, data);
      } else {
        await createUpstream({
          ...baseData,
          ...(upstreamCredentialType !== 'none' ? {
            credential_type: upstreamCredentialType,
            ...(upstreamCredentialType === 'header' && upstreamCredentialKey.trim()
              ? { credential_key: upstreamCredentialKey.trim() }
              : {}),
            ...(upstreamCredentialValue ? { credential_value: upstreamCredentialValue } : {}),
          } : {}),
        });
      }
      setUpstreamFormOpen(false);
      setEditingUpstream(null);
      setUpstreamCredentialValue('');
      await loadUpstreams();
      setAdminNotice(editingUpstream ? 'Upstream server updated.' : 'Upstream server added.');
      setTimeout(() => setAdminNotice(null), 3000);
    } catch (err) {
      setUpstreamsError(err instanceof Error ? err.message : 'Failed to save upstream server.');
    } finally {
      setUpstreamSaving(false);
    }
  };

  const handleRemoveUpstream = async (upstream: UpstreamServer) => {
    if (!confirm(`Remove upstream server "${upstream.name}"? This cannot be undone.`)) return;
    setUpstreamsError(null);
    try {
      await deleteUpstream(upstream.id);
      await loadUpstreams();
      setAdminNotice(`Upstream server removed.`);
      setTimeout(() => setAdminNotice(null), 3000);
    } catch (err) {
      setUpstreamsError(err instanceof Error ? err.message : 'Failed to remove upstream server.');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;

    setLoginLoading(true);
    try {
      const result = await verifyApiKey(trimmed);
      onUserChange(result.user);
      setApiKeyInput('');
    } catch (err: any) {
      setLoginError(err.message || 'Invalid or revoked API key. Please check your credentials.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    void logoutSession().catch(() => undefined).finally(() => {
      onUserChange(null);
      setMyKeys([]);
    });
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await createMyKey(newKeyName.trim() || 'operator-key');
      setGeneratedPlaintextKey(created.key);
      setNewKeyName('');
      loadKeys();
    } catch (err: any) {
      alert(err.message || 'Failed to create key');
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;
    try {
      await revokeMyKey(keyId);
      loadKeys();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke key');
    }
  };

  const handleToggleUpstream = async (id: string, current: boolean) => {
    try {
      await toggleUpstream(id, !current);
      await loadUpstreams();
      setAdminNotice(`Upstream server updated.`);
      setTimeout(() => setAdminNotice(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to toggle upstream');
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUsername.trim()) return;
    try {
      await createUser({ username: inviteUsername.trim(), role: inviteRole });
      setInviteUsername('');
      loadAdminData();
      setAdminNotice(`User ${inviteUsername} created successfully.`);
      setTimeout(() => setAdminNotice(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to invite user');
    }
  };

  const loadMemberKeys = async (member: User) => {
    setMemberKeysOpen(current => ({ ...current, [member.id]: true }));
    setMemberKeyBusy(member.id);
    try {
      const keys = await fetchUserKeysAdmin(member.id);
      setMemberKeys(current => ({ ...current, [member.id]: keys }));
    } catch (err) {
      setAdminNotice(err instanceof Error ? err.message : 'Failed to load member keys.');
    } finally {
      setMemberKeyBusy(null);
    }
  };

  const handleIssueMemberKey = async (member: User) => {
    setMemberKeyBusy(member.id);
    try {
      const created = await createKeyForUserAdmin(member.id, memberKeyName.trim() || `admin-issued-${member.username}`);
      setIssuedMemberKey({ username: member.username, key: created.key });
      setMemberKeyName('');
      const keys = await fetchUserKeysAdmin(member.id);
      setMemberKeys(current => ({ ...current, [member.id]: keys }));
      setMemberKeysOpen(current => ({ ...current, [member.id]: true }));
    } catch (err) {
      setAdminNotice(err instanceof Error ? err.message : 'Failed to issue member key.');
    } finally {
      setMemberKeyBusy(null);
    }
  };

  const handleRevokeMemberKey = async (member: User, key: ApiKeyItem) => {
    if (!confirm(`Revoke the API key "${key.name}" for ${member.username}? This cannot be undone.`)) return;
    setMemberKeyBusy(member.id);
    try {
      await revokeKeyAdmin(key.id);
      const keys = await fetchUserKeysAdmin(member.id);
      setMemberKeys(current => ({ ...current, [member.id]: keys }));
    } catch (err) {
      setAdminNotice(err instanceof Error ? err.message : 'Failed to revoke member key.');
    } finally {
      setMemberKeyBusy(null);
    }
  };

  if (!user) {
    return (
      <div className="account-login-container">
        <div className="apple-login-card">
          <div className="login-badge-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zM9 7a3 3 0 0 1 6 0v3H9V7z" />
            </svg>
          </div>

          <h1 className="login-title">Sign in with API Key</h1>
          <p className="login-subtitle">
            Enter your provisioned Urumi MCP API key to access account settings, orders, and administrative routing controls.
          </p>

          {loginError && <div className="login-error-alert">{loginError}</div>}

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label className="form-label">API Key</label>
              <input
                type="password"
                className="apple-form-input font-mono"
                placeholder="urumi_..."
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="button button-wide"
              disabled={loginLoading}
            >
              <span>{loginLoading ? 'Verifying...' : 'Authorize'}</span>
            </button>
          </form>

          <div className="login-help-box">
            <div className="help-heading">Need a key?</div>
            <p>
              Run this in your terminal to generate an admin token:
            </p>
            <code>npm run provision:admin</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="account-dashboard-container">
      {/* Account Profile Header */}
      <section className="account-profile-header">
        <div className="profile-badge-row">
          <div className="profile-avatar">
            {user.username.slice(0, 2).toUpperCase()}
          </div>
          <div className="profile-meta">
            <div className="profile-name-row">
              <h1 className="profile-username">{user.username}</h1>
              <span className={`role-badge ${user.role}`}>
                {user.role.toUpperCase()}
              </span>
            </div>
            <span className="profile-id">ID: {user.id}</span>
          </div>
        </div>

        <button className="btn-signout" onClick={handleLogout}>
          Sign Out
        </button>
      </section>

      {adminNotice && <div className="sync-status-badge">{adminNotice}</div>}

      {/* Account Sub Navigation */}
      <div className="account-subnav-bar">
        <button
          className={`subnav-pill ${subTab === 'keys' ? 'active' : ''}`}
          onClick={() => setSubTab('keys')}
        >
          My API Keys ({myKeys.length})
        </button>
        <button
          className={`subnav-pill ${subTab === 'orders' ? 'active' : ''}`}
          onClick={() => setSubTab('orders')}
        >
          Orders ({orders.length})
        </button>
        {user.role === 'admin' && (
          <>
            <button
              className={`subnav-pill ${subTab === 'upstreams' ? 'active' : ''}`}
              onClick={() => setSubTab('upstreams')}
            >
              Upstream MCP Servers ({upstreams.length})
            </button>
            <button
              className={`subnav-pill ${subTab === 'users' ? 'active' : ''}`}
              onClick={() => setSubTab('users')}
            >
              Team Members ({teamUsers.length})
            </button>
            <button
              className={`subnav-pill ${subTab === 'audit' ? 'active' : ''}`}
              onClick={() => setSubTab('audit')}
            >
              Tool Audit ({auditLogs.length})
            </button>
          </>
        )}
      </div>

      {/* Tab 1: API Keys */}
      {subTab === 'keys' && (
        <div className="account-tab-content">
          <div className="tab-section-header">
            <div>
              <h2>Personal API Keys</h2>
              <p>Keys used by your CLI, agents, and external applications to access the MCP Gateway.</p>
            </div>
            <button className="button" onClick={() => setShowGenModal(true)}>
              <span>+ New Key</span>
            </button>
          </div>

          <div className="keys-list-container">
            {keysLoading ? (
              <div className="tab-loading-state">Loading credentials...</div>
            ) : myKeys.length === 0 ? (
              <div className="empty-state-box">
                <p>No active API keys found for this account.</p>
              </div>
            ) : (
              <div className="apple-table-card">
                <table className="apple-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Key Prefix</th>
                      <th>Created</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myKeys.map(k => (
                      <tr key={k.id}>
                        <td className="font-semibold">{k.name}</td>
                        <td>
                          <code className="key-prefix-badge">{k.key_prefix}...</code>
                        </td>
                        <td>{new Date(k.created_at * 1000).toLocaleDateString()}</td>
                        <td>
                          {k.revoked_at ? (
                            <span className="status-tag revoked">Revoked</span>
                          ) : (
                            <span className="status-tag active">Active</span>
                          )}
                        </td>
                        <td>
                          {!k.revoked_at && (
                            <button
                              className="btn-text-danger"
                              onClick={() => handleRevokeKey(k.id)}
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Orders */}
      {subTab === 'orders' && (
        <div className="account-tab-content">
          <div className="tab-section-header">
            <div>
              <h2>Order History</h2>
              <p>Hardware orders routed and tracked through the MCP Gateway store.</p>
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="empty-state-box">
              <p>You have not placed any orders during this session yet.</p>
            </div>
          ) : (
            <div className="orders-stack">
              {orders.map(ord => (
                <div key={ord.id} className="order-record-card">
                  <div className="order-record-top">
                    <div>
                      <span className="order-id-label">Order #{ord.id}</span>
                      <span className="order-date-label">Placed on {ord.date}</span>
                    </div>
                    <div className="order-status-badge">{ord.status.toUpperCase()}</div>
                  </div>

                  <div className="order-record-items">
                    {ord.items.map(item => (
                      <div key={item.product.id} className="order-item-inline">
                        <img src={item.product.image} alt={item.product.name} />
                        <span className="item-name">{item.product.name} (x{item.quantity})</span>
                        <span className="item-price">${(item.product.price * item.quantity).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>

                  <div className="order-record-footer">
                    <span>Total: <strong className="text-white">${ord.total.toLocaleString()}</strong></span>
                    <span>Delivering to: {ord.customer.name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Admin Upstreams */}
      {subTab === 'upstreams' && user.role === 'admin' && (
        <div className="account-tab-content">
          <div className="tab-section-header">
            <div>
              <h2>Upstream MCP Server Nodes</h2>
              <p>Connection health, available tools, and routing settings for MCP endpoints.</p>
            </div>
            <div className="shop-actions-group">
              <button className="button" onClick={loadUpstreams} disabled={upstreamsLoading}>
                <span>{upstreamsLoading ? 'Refreshing...' : 'Refresh'}</span>
              </button>
              <button className="button" onClick={() => openUpstreamForm()}>
                <span>+ Add Server</span>
              </button>
            </div>
          </div>

          {upstreamsError && <div className="login-error-alert" role="alert">{upstreamsError}</div>}
          {upstreamsLoading && upstreams.length === 0 && (
            <div className="tab-loading-state">Loading upstream servers and tools...</div>
          )}
          {!upstreamsLoading && upstreams.length === 0 && !upstreamsError && (
            <div className="empty-state-box"><p>No upstream MCP servers are registered.</p></div>
          )}
          <div className="upstreams-grid">
            {upstreams.map(up => (
              <div key={up.id} className="upstream-status-card">
                <div className="upstream-card-header">
                  <div>
                    <h3 className="upstream-title">{up.name}</h3>
                    <code className="upstream-url">{up.url}</code>
                    <div className="tool-count-metric">{up.toolCount ?? 0} tools</div>
                    {up.error && <div className="login-error-alert">Connection probe failed.</div>}
                  </div>
                  <div className={`status-pill ${up.status === 'connected' ? 'online' : 'offline'}`}>
                    {(up.status || (up.enabled ? 'checking' : 'disabled')).toUpperCase()}
                  </div>
                </div>

                <div className="upstream-tools-list">
                  <strong>Available tools</strong>
                  {up.enabled ? (
                    upstreamTools.filter(tool => tool._upstreamId === up.id).length > 0 ? (
                      <ul>
                        {upstreamTools.filter(tool => tool._upstreamId === up.id).map(tool => (
                          <li key={tool.name}>
                            <code>{tool._originalName || tool.name}</code>
                            {tool.description && <span> — {tool.description}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : <p>{up.status === 'connected' ? 'No tools were reported.' : 'Tools unavailable while this server is unreachable.'}</p>
                  ) : <p>Enable this server to discover its tools.</p>}
                </div>

                <div className="upstream-card-footer">
                  <span className="tool-count-metric">
                    {up.has_credential ? '🔒 Authenticated' : '🔓 Public / Local'}
                  </span>
                  <button
                    className={`btn-toggle-switch ${up.enabled ? 'on' : 'off'}`}
                    onClick={() => handleToggleUpstream(up.id, up.enabled)}
                    disabled={upstreamsLoading}
                  >
                    {up.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
                <div className="upstream-card-footer">
                  <button className="btn-cancel" onClick={() => openUpstreamForm(up)}>Edit</button>
                  <button className="btn-text-danger" onClick={() => handleRemoveUpstream(up)}>Remove</button>
                </div>
              </div>
            ))}
          </div>

          {upstreamFormOpen && (
            <div className="apple-modal-overlay" onClick={closeUpstreamForm}>
              <div className="apple-modal-card" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>{editingUpstream ? 'Edit Upstream MCP Server' : 'Add Upstream MCP Server'}</h2>
                  <button className="modal-close-btn" onClick={closeUpstreamForm} disabled={upstreamSaving}>×</button>
                </div>
                <form onSubmit={handleSaveUpstream}>
                  <div className="form-group">
                    <label className="form-label">Server name</label>
                    <input className="apple-form-input" required value={upstreamName} onChange={e => setUpstreamName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">MCP server URL</label>
                    <input className="apple-form-input" type="url" required placeholder="https://server.example/mcp" value={upstreamUrl} onChange={e => setUpstreamUrl(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Authentication</label>
                    <select className="apple-form-input" value={upstreamCredentialType} onChange={e => setUpstreamCredentialType(e.target.value as 'none' | 'header' | 'bearer')}>
                      <option value="none">None</option>
                      <option value="bearer">Bearer token</option>
                      <option value="header">Custom header</option>
                    </select>
                  </div>
                  {upstreamCredentialType === 'header' && (
                    <div className="form-group">
                      <label className="form-label">Header name</label>
                      <input className="apple-form-input" placeholder="X-Api-Key" value={upstreamCredentialKey} onChange={e => setUpstreamCredentialKey(e.target.value)} />
                    </div>
                  )}
                  {upstreamCredentialType !== 'none' && (
                    <div className="form-group">
                      <label className="form-label">{upstreamCredentialType === 'bearer' ? 'Bearer token' : 'Header value'}</label>
                      <input
                        className="apple-form-input"
                        type="password"
                        autoComplete="new-password"
                        placeholder={editingUpstream?.has_credential ? 'Leave blank to keep the saved credential' : 'Optional'}
                        value={upstreamCredentialValue}
                        onChange={e => setUpstreamCredentialValue(e.target.value)}
                      />
                      {editingUpstream?.has_credential && (
                        <label className="form-label">
                          <input type="checkbox" checked={clearUpstreamCredential} onChange={e => setClearUpstreamCredential(e.target.checked)} /> Clear saved credential
                        </label>
                      )}
                    </div>
                  )}
                  {upstreamsError && <div className="login-error-alert" role="alert">{upstreamsError}</div>}
                  <div className="modal-actions-footer">
                    <button type="button" className="btn-cancel" onClick={closeUpstreamForm} disabled={upstreamSaving}>Cancel</button>
                    <button type="submit" className="button" disabled={upstreamSaving}>
                      <span>{upstreamSaving ? 'Saving...' : editingUpstream ? 'Save Changes' : 'Add Server'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Admin Team Users */}
      {subTab === 'users' && user.role === 'admin' && (
        <div className="account-tab-content">
          <div className="tab-section-header">
            <div>
              <h2>Team & Role Management</h2>
              <p>Manage gateway permissions and member access tokens.</p>
            </div>
          </div>

          <div className="invite-form-card">
            <form onSubmit={handleInviteUser} className="inline-invite-form">
              <input
                type="text"
                placeholder="Username (e.g. dev-agent-1)"
                required
                className="apple-form-input"
                value={inviteUsername}
                onChange={e => setInviteUsername(e.target.value)}
              />
              <select
                className="apple-form-input"
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}
              >
                <option value="member">Member</option>
                <option value="admin">Administrator</option>
              </select>
              <button type="submit" className="button">
                <span>Invite</span>
              </button>
            </form>
          </div>

          <div className="apple-table-card">
            <table className="apple-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>User ID</th>
                  <th>Created</th>
                  <th>API Keys</th>
                </tr>
              </thead>
              <tbody>
                {teamUsers.map(u => (
                  <React.Fragment key={u.id}>
                  <tr key={u.id}>
                    <td className="font-semibold">{u.username}</td>
                    <td>
                      <span className={`role-badge ${u.role}`}>{u.role.toUpperCase()}</span>
                    </td>
                    <td><code className="key-prefix-badge">{u.id}</code></td>
                    <td>{u.created_at ? new Date(u.created_at * 1000).toLocaleDateString() : 'Active'}</td>
                    <td>
                      <div className="shop-actions-group">
                        <button className="btn-cancel" disabled={memberKeyBusy === u.id} onClick={() => memberKeysOpen[u.id] ? setMemberKeysOpen(current => ({ ...current, [u.id]: false })) : loadMemberKeys(u)}>
                          {memberKeysOpen[u.id] ? 'Hide keys' : 'Manage keys'}
                        </button>
                        {u.role === 'member' && <button className="button" disabled={memberKeyBusy === u.id} onClick={() => handleIssueMemberKey(u)}>
                          Issue key
                        </button>}
                      </div>
                    </td>
                  </tr>
                  {memberKeysOpen[u.id] && (
                    <tr key={`${u.id}-keys`}>
                      <td colSpan={5}>
                        {memberKeyBusy === u.id && !memberKeys[u.id] ? <div className="tab-loading-state">Loading API keys...</div> : (
                          <div className="apple-table-card">
                            <table className="apple-table">
                              <thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Status</th><th>Action</th></tr></thead>
                              <tbody>{(memberKeys[u.id] || []).map(key => <tr key={key.id}>
                                <td className="font-semibold">{key.name}</td>
                                <td><code className="key-prefix-badge">{key.key_prefix}...</code></td>
                                <td>{new Date(key.created_at * 1000).toLocaleDateString()}</td>
                                <td>{key.revoked_at ? <span className="status-tag revoked">Revoked</span> : <span className="status-tag active">Active</span>}</td>
                                <td>{!key.revoked_at && <button className="btn-text-danger" disabled={memberKeyBusy === u.id} onClick={() => handleRevokeMemberKey(u, key)}>Revoke</button>}</td>
                              </tr>)}</tbody>
                            </table>
                            {(memberKeys[u.id] || []).length === 0 && <p>No API keys have been issued.</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'audit' && user.role === 'admin' && (
        <div className="account-tab-content">
          <div className="tab-section-header">
            <div><h2>Recent Tool Calls</h2><p>Latest 100 calls recorded by the gateway.</p></div>
            <button className="button" onClick={loadAdminData}><span>Refresh</span></button>
          </div>
          {auditLogs.length === 0 ? (
            <div className="empty-state-box"><p>No tool calls have been recorded.</p></div>
          ) : (
            <div className="apple-table-card">
              <table className="apple-table">
                <thead><tr><th>Time</th><th>User</th><th>Server</th><th>Tool</th><th>Duration</th><th>Result</th></tr></thead>
                <tbody>{auditLogs.map(log => (
                  <tr key={log.id}>
                    <td>{new Date(log.called_at * 1000).toLocaleString()}</td>
                    <td>{log.username || 'Unknown'}</td>
                    <td>{log.upstream_name || 'Unknown'}</td>
                    <td><code>{log.tool_name}</code></td>
                    <td>{log.duration_ms ?? '—'} ms</td>
                    <td>{log.success ? 'Success' : `Failed${log.error_message ? `: ${log.error_message}` : ''}`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal: Generate New Key */}
      {showGenModal && (
        <div className="apple-modal-overlay" onClick={() => { setShowGenModal(false); setGeneratedPlaintextKey(null); }}>
          <div className="apple-modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Generate Gateway API Key</h2>
              <button className="modal-close-btn" onClick={() => { setShowGenModal(false); setGeneratedPlaintextKey(null); }}>✕</button>
            </div>

            {!generatedPlaintextKey ? (
              <form onSubmit={handleCreateKey}>
                <div className="form-group">
                  <label className="form-label">Key Label / Name</label>
                  <input
                    type="text"
                    required
                    className="apple-form-input"
                    placeholder="e.g. Production Agent / MacBook Pro"
                    value={newKeyName}
                    onChange={e => setNewKeyName(e.target.value)}
                  />
                </div>

                <div className="modal-actions-footer">
                  <button type="button" className="btn-cancel" onClick={() => setShowGenModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="button">
                    <span>Generate</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="new-key-success-box">
                <div className="alert-green">
                  ✓ Key generated! Save this token now. It will never be shown again.
                </div>
                <div className="form-group">
                  <label className="form-label">Plaintext Secret Key</label>
                  <input
                    type="text"
                    readOnly
                    className="apple-form-input font-mono"
                    value={generatedPlaintextKey}
                  />
                </div>
                <button
                  className="button button-wide"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedPlaintextKey);
                    alert('API Key copied to clipboard!');
                    setGeneratedPlaintextKey(null);
                    setShowGenModal(false);
                  }}
                >
                  <span>Copy Key & Done</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {issuedMemberKey && (
        <div className="apple-modal-overlay" onClick={() => setIssuedMemberKey(null)}>
          <div className="apple-modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>API Key for {issuedMemberKey.username}</h2><button className="modal-close-btn" onClick={() => setIssuedMemberKey(null)}>×</button></div>
            <div className="new-key-success-box">
              <div className="alert-green" role="alert">Key issued. Save it securely now; it will only be shown once.</div>
              <div className="form-group"><label className="form-label">Plaintext API Key</label><input type="password" autoComplete="new-password" readOnly className="apple-form-input font-mono" value={issuedMemberKey.key} onFocus={e => e.currentTarget.type = 'text'} /></div>
              <button className="button button-wide" onClick={async () => { try { await navigator.clipboard.writeText(issuedMemberKey.key); } catch { /* Admin can reveal and copy manually. */ } setIssuedMemberKey(null); }}><span>Copy key and close</span></button>
              <button className="btn-cancel" onClick={() => setIssuedMemberKey(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
