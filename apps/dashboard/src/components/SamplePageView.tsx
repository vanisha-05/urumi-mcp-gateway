import React, { useState, useEffect } from 'react';
import {
  executeToolCall,
  fetchAggregatedTools,
  fetchUpstreams,
  toggleUpstream,
  ToolDef,
  UpstreamServer,
  User,
} from '../api';

interface SamplePageViewProps {
  user: User | null;
}

type IntegrationKey = 'woocommerce' | 'system' | 'inventory';

const integrationCards: Array<{
  key: IntegrationKey;
  title: string;
  description: string;
  icon: 'store' | 'system' | 'warehouse';
}> = [
  {
    key: 'woocommerce',
    title: 'WooCommerce Store',
    description: 'Catalog, orders, and store operations.',
    icon: 'store',
  },
  {
    key: 'system',
    title: 'System & Utilities',
    description: 'Gateway health and system utility tools.',
    icon: 'system',
  },
  {
    key: 'inventory',
    title: 'Warehouse & Inventory',
    description: 'Warehouse stock and inventory operations.',
    icon: 'warehouse',
  },
];

function getIntegrationKey(name: string): IntegrationKey {
  const normalized = name.toLowerCase();
  if (normalized.includes('woo') || normalized.includes('commerce')) return 'woocommerce';
  if (normalized.includes('warehouse') || normalized.includes('inventory') || normalized.includes('stock')) {
    return 'inventory';
  }
  return 'system';
}

function getToolIdentifier(tool: ToolDef): string {
  const identifier = tool._originalName || tool.name;
  return identifier.replace(/^[0-9a-f]{8}-[0-9a-f-]{27}__/i, '').split('__').pop() || identifier;
}

function getToolLabel(tool: ToolDef): string {
  const name = getToolIdentifier(tool)
    .replace(/^(get|fetch|check|list)_/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return name.replace(/\b\w/g, character => character.toUpperCase());
}

export function SamplePageView({ user }: SamplePageViewProps) {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamServer[]>([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [upstreamsError, setUpstreamsError] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<ToolDef | null>(null);
  const [toolArgsJson, setToolArgsJson] = useState('{\n  "per_page": 5\n}');
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [busyUpstreamId, setBusyUpstreamId] = useState<string | null>(null);

  useEffect(() => {
    void loadTools();
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') {
      void loadUpstreams();
    } else {
      setUpstreams([]);
      setUpstreamsError(null);
    }
  }, [user]);

  const loadTools = async () => {
    setLoadingTools(true);
    setToolsError(null);
    try {
      const res = await fetchAggregatedTools();
      setTools(res?.tools || []);
      setSelectedTool(current => (
        res?.tools?.find(tool => tool.name === current?.name)
        || res?.tools?.[0]
        || null
      ));
    } catch (err) {
      setTools([]);
      setSelectedTool(null);
      setToolsError(err instanceof Error ? err.message : 'Failed to load gateway tools.');
    } finally {
      setLoadingTools(false);
    }
  };

  const loadUpstreams = async () => {
    setUpstreamsError(null);
    try {
      setUpstreams(await fetchUpstreams());
    } catch (err) {
      setUpstreams([]);
      setUpstreamsError(err instanceof Error ? err.message : 'Failed to load upstream server status.');
    }
  };

  const handleToggleUpstream = async (upstream: UpstreamServer) => {
    setBusyUpstreamId(upstream.id);
    setUpstreamsError(null);
    try {
      await toggleUpstream(upstream.id, !upstream.enabled);
      await Promise.all([loadUpstreams(), loadTools()]);
    } catch (err) {
      setUpstreamsError(err instanceof Error ? err.message : 'Failed to update upstream server.');
    } finally {
      setBusyUpstreamId(null);
    }
  };

  const handleSelectTool = (t: ToolDef) => {
    setSelectedTool(t);
    setExecutionResult(null);
    const identifier = getToolIdentifier(t);
    if (identifier.includes('products')) {
      setToolArgsJson('{\n  "per_page": 5\n}');
    } else if (identifier.includes('orders')) {
      setToolArgsJson('{\n  "status": "processing"\n}');
    } else if (identifier.includes('hello')) {
      setToolArgsJson('{\n  "name": "Operator"\n}');
    } else {
      setToolArgsJson('{}');
    }
  };

  const handleRunTool = async () => {
    if (!selectedTool) return;
    setExecuting(true);
    setExecutionResult(null);

    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(toolArgsJson);
    } catch (err: any) {
      setExecutionResult({ error: 'Invalid JSON arguments format', details: err.message });
      setExecuting(false);
      return;
    }

    try {
      const res = await executeToolCall(selectedTool.name, parsedArgs);
      setExecutionResult(res);
    } catch (err: any) {
      setExecutionResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="sample-page-container">
      <section className="integration-overview">
        <div className="integration-page-heading">
          <div>
            <span className="integration-eyebrow">Gateway capabilities</span>
            <h1>Gateway integrations</h1>
            <p>Discover available tools and inspect the upstream services behind your gateway.</p>
          </div>
          <div className={`gateway-health-card ${toolsError ? 'offline' : loadingTools ? 'checking' : 'healthy'}`}>
            <span className={`status-dot ${toolsError ? 'offline' : loadingTools ? 'checking' : 'healthy'}`} />
            <span>
              <strong>
                {loadingTools ? 'Checking gateway access' : toolsError ? 'Gateway access unavailable' : 'Gateway tools responding'}
              </strong>
              <small>Based on live tool discovery</small>
            </span>
          </div>
        </div>

        {toolsError && <div className="integration-error" role="alert">{toolsError}</div>}
        {upstreamsError && <div className="integration-error" role="alert">{upstreamsError}</div>}

        <div className="integration-cards-grid">
          {integrationCards.map(card => {
            const servers = upstreams.filter(server => getIntegrationKey(server.name) === card.key);
            const serverTools = tools.filter(tool => {
              const upstreamName = tool._upstreamName
                || upstreams.find(server => server.id === tool._upstreamId)?.name
                || '';
              return getIntegrationKey(upstreamName) === card.key;
            });
            const availableCount = servers.length
              ? servers.reduce((count, server) => count + tools.filter(tool => tool._upstreamId === server.id).length, 0)
              : serverTools.length;

            return (
              <article className={`integration-card integration-${card.key}`} key={card.key}>
                <header className="integration-card-header">
                  <div className="integration-title-group">
                    <span className="integration-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        {card.icon === 'store' ? (
                          <>
                            <path d="M3 10h18M5 10v10h14V10M6 5h12l2 5H4l2-5Z" />
                            <path d="M9 20v-6h6v6" />
                          </>
                        ) : card.icon === 'system' ? (
                          <>
                            <circle cx="12" cy="12" r="3" />
                            <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.7Z" />
                          </>
                        ) : (
                          <>
                            <path d="m3 9 9-5 9 5v11H3V9Z" />
                            <path d="M9 20v-6h6v6M7 10h2m6 0h2" />
                          </>
                        )}
                      </svg>
                    </span>
                    <div>
                      <h2>{card.title}</h2>
                      <p>{card.description}</p>
                    </div>
                  </div>
                  <span className="integration-tool-count">
                    {loadingTools ? 'Loading' : `${availableCount} ${availableCount === 1 ? 'tool' : 'tools'}`}
                  </span>
                </header>

                {servers.length > 0 ? (
                  <div className="integration-servers">
                    {servers.map(server => {
                      const status = server.status || (server.enabled ? 'checking' : 'disabled');
                      return (
                        <div className="integration-server-row" key={server.id}>
                          <span className={`integration-status-dot ${status}`} />
                          <span className="integration-server-name">{server.name}</span>
                          <span className={`integration-status-label ${status}`}>{status}</span>
                          {user?.role === 'admin' && (
                            <button
                              className={`integration-toggle ${server.enabled ? 'enabled' : 'disabled'}`}
                              type="button"
                              onClick={() => void handleToggleUpstream(server)}
                              disabled={busyUpstreamId === server.id}
                              aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
                            >
                              {busyUpstreamId === server.id ? 'Saving…' : server.enabled ? 'Disable' : 'Enable'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="integration-connection-state">
                    {user?.role === 'admin' && upstreamsError
                      ? 'Server status could not be loaded.'
                      : user?.role === 'admin'
                        ? 'No upstream server registered.'
                        : serverTools.length > 0
                          ? 'Tools discovered from this integration.'
                          : 'Sign in to view live server status.'}
                  </div>
                )}

                <div className="integration-tools-heading">
                  <span>Available tools</span>
                  <span>{serverTools.length}</span>
                </div>
                <div className="integration-tools-list">
                  {loadingTools ? (
                    <div className="integration-empty-state">Discovering tools…</div>
                  ) : toolsError ? (
                    <div className="integration-empty-state">Tool discovery failed.</div>
                  ) : serverTools.length === 0 ? (
                    <div className="integration-empty-state">
                      {servers.some(server => !server.enabled)
                        ? 'Enable this server to discover its tools.'
                        : 'No tools available for this integration.'}
                    </div>
                  ) : (
                    serverTools.map(tool => (
                      <div className="integration-tool-item" key={tool.name}>
                        <div className="integration-tool-name">{getToolLabel(tool)}</div>
                        <code className="integration-tool-identifier">{getToolIdentifier(tool)}</code>
                        <p>{tool.description || 'No description provided by this tool.'}</p>
                      </div>
                    ))
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Live Tool Runner Console */}
      <section className="tool-runner-section">
        <div className="tool-runner-header">
          <div>
            <h2>Interactive Tool Playground</h2>
            <p>Execute live Model Context Protocol tools directly through the gateway dispatch engine.</p>
          </div>
          <button className="button" onClick={() => void loadTools()} disabled={loadingTools}>
            <span>{loadingTools ? 'Loading...' : 'Refresh Tools'}</span>
          </button>
        </div>

        <div className="tool-runner-workbench">
          {/* Tool selector list */}
          <div className="tools-selector-sidebar">
            <span className="sidebar-list-heading">Available Upstream Tools ({tools.length})</span>
            <div className="tools-items-list">
              {tools.map(t => (
                <button
                  key={t.name}
                  className={`tool-select-btn ${selectedTool?.name === t.name ? 'active' : ''}`}
                  onClick={() => handleSelectTool(t)}
                >
                  <span className="tool-btn-name">{getToolLabel(t)}</span>
                  <code className="tool-btn-identifier">{getToolIdentifier(t)}</code>
                  <span className="tool-btn-desc">{t.description || 'No description provided by this tool.'}</span>
                </button>
              ))}
              {!loadingTools && toolsError && <div className="integration-empty-state">{toolsError}</div>}
              {!loadingTools && !toolsError && tools.length === 0 && (
                <div className="integration-empty-state">No gateway tools are available.</div>
              )}
            </div>
          </div>

          {/* Workbench execution zone */}
          <div className="tools-execution-panel">
            {selectedTool ? (
              <>
                <div className="active-tool-banner">
                  <span className="tool-title-badge">{getToolLabel(selectedTool)}</span>
                  <code className="active-tool-identifier">{getToolIdentifier(selectedTool)}</code>
                  <p className="tool-full-desc">{selectedTool.description}</p>
                </div>

                <div className="args-editor-box">
                  <label className="editor-label">JSON Request Arguments</label>
                  <textarea
                    className="apple-code-editor"
                    rows={5}
                    value={toolArgsJson}
                    onChange={e => setToolArgsJson(e.target.value)}
                  />
                </div>

                <div className="run-button-row">
                  <button
                    className="button button-wide"
                    onClick={handleRunTool}
                    disabled={executing}
                  >
                    <span>{executing ? 'Executing Tool...' : 'Execute Tool'}</span>
                  </button>
                </div>

                {/* Output terminal */}
                {executionResult && (
                  <div className="execution-output-box">
                    <div className="output-header">
                      <span>Live Response Output</span>
                      <button className="btn-copy-code" onClick={() => navigator.clipboard.writeText(JSON.stringify(executionResult, null, 2))}>
                        Copy JSON
                      </button>
                    </div>
                    <pre className="output-terminal">
                      {JSON.stringify(executionResult, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <div className="no-tool-selected-placeholder">
                <p>Select a tool from the left sidebar to inspect and run.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
