import React, { createContext, useContext, useState } from 'react'
import RawLink from '@docusaurus/Link'
import clsx from 'clsx'
import styles from './styles.module.css'

// @docusaurus/Link bundles its own @types/react where ReactNode includes bigint;
// alias it through this file's React types so the duplicate-types mismatch
// ("Link cannot be used as a JSX component") doesn't fail `tsc`.
const Link = RawLink as unknown as React.FC<
    React.PropsWithChildren<{ to: string; className?: string; onMouseEnter?: () => void; onMouseLeave?: () => void }>
>

/**
 * Interactive at-scale system-design diagram for @mt-tl/server.
 *
 * The story it tells (vs a broker/RPC-handler design): the MTProto engine and
 * your handlers run in ONE process (InProcessForwarder, no broker). Scale = a
 * uniform fleet of replicas behind a load balancer, with shared state in
 * Mongo + Redis, and presence-routed server-push over a Redis bus.
 *
 * Every node links to the doc section that explains it. Hovering a node — or a
 * flow step in the bottom panels — cross-highlights everything on the same flow
 * (`req` = request lifecycle, `push` = server-push).
 */

type Focus = { active: string | null; set: (g: string | null) => void }
const FocusCtx = createContext<Focus>({ active: null, set: () => {} })

type Accent = 'blue' | 'purple' | 'green' | 'teal' | 'amber' | 'red'
const accentClass: Record<Accent, string> = {
    blue: styles.aBlue,
    purple: styles.aPurple,
    green: styles.aGreen,
    teal: styles.aTeal,
    amber: styles.aAmber,
    red: styles.aRed,
}

function useFocusState(groups: string[]) {
    const { active, set } = useContext(FocusCtx)
    const on = active != null && groups.includes(active)
    const dim = active != null && !on
    const hover = groups.length
        ? { onMouseEnter: () => set(groups[0]), onMouseLeave: () => set(null) }
        : {}
    return { on, dim, hover }
}

type NodeProps = {
    title: React.ReactNode
    sub?: React.ReactNode
    to?: string
    accent?: Accent
    groups?: string[]
    children?: React.ReactNode
}

function Node({ title, sub, to, accent, groups = [], children }: NodeProps) {
    const { on, dim, hover } = useFocusState(groups)
    const cls = clsx(styles.node, accent && accentClass[accent], on && styles.nodeOn, dim && styles.nodeDim)
    const body = (
        <>
            <p className={styles.nTitle}>
                {accent && <span className={styles.dot} aria-hidden="true" />}
                {title}
            </p>
            {sub && <p className={styles.nSub}>{sub}</p>}
            {children}
        </>
    )
    if (to) {
        return (
            <Link to={to} className={cls} {...hover}>
                {body}
            </Link>
        )
    }
    return (
        <div className={cls} {...hover}>
            {body}
        </div>
    )
}

type StepProps = {
    n: React.ReactNode
    kind?: 'blue' | 'green' | 'warn'
    flow: string
    children: React.ReactNode
}

function Step({ n, kind = 'blue', flow, children }: StepProps) {
    const { active } = useContext(FocusCtx)
    const on = active === flow
    const dim = active != null && !on
    const numCls = clsx(styles.num, kind === 'green' && styles.numGreen, kind === 'warn' && styles.numWarn)
    return (
        <li className={clsx(styles.step, on && styles.stepOn, dim && styles.stepDim)}>
            <span className={numCls}>{n}</span>
            <p className={clsx(styles.stepText, kind === 'warn' && styles.warnText)}>{children}</p>
        </li>
    )
}

function Panel({ title, flow, children }: { title: string; flow?: string; children: React.ReactNode }) {
    const { set } = useContext(FocusCtx)
    const hover = flow ? { onMouseEnter: () => set(flow), onMouseLeave: () => set(null) } : {}
    return (
        <div className={styles.panel} {...hover}>
            <p className={styles.panelHead}>{title}</p>
            {children}
        </div>
    )
}

const M = ({ children }: { children: React.ReactNode }) => <code className={styles.mono}>{children}</code>

export default function SystemDesign() {
    const [active, set] = useState<string | null>(null)

    return (
        <FocusCtx.Provider value={{ active, set }}>
            <div className={styles.canvas} role="group" aria-label="mt-tl server system design at scale">
                <h2 className={styles.srOnly}>
                    At-scale architecture of an @mt-tl/server app: clients reach a uniform fleet of replicas behind a
                    load balancer; the MTProto engine and your handlers run in one process; shared state lives in
                    MongoDB and Redis; server-push is presence-routed over a Redis bus.
                </h2>

                <div className={styles.head}>
                    mtproto server · <b>in-process handlers</b> · uniform replica fleet — system design
                </div>

                <div className={styles.cols}>
                    {/* CLIENTS */}
                    <div className={styles.col}>
                        <div className={clsx(styles.colHead, styles.tClients)}>Clients</div>
                        <div className={styles.stack}>
                            <Node
                                title="Mobile"
                                sub={<>raw-TCP MTProto</>}
                                accent="blue"
                                groups={['req']}
                                to="/internals/architecture"
                            />
                            <Node
                                title="Desktop"
                                sub={<>raw-TCP MTProto</>}
                                accent="blue"
                                groups={['req']}
                                to="/internals/architecture"
                            />
                            <Node
                                title="Web"
                                sub={<>WebSocket / MTProto</>}
                                accent="blue"
                                groups={['req']}
                                to="/internals/architecture"
                            />
                            <p className={styles.note}>
                                Same auth key = one device login; all its sessions become authorized.
                            </p>
                        </div>
                    </div>

                    {/* EDGE */}
                    <div className={styles.col}>
                        <div className={clsx(styles.colHead, styles.tEdge)}>Edge · load balancer</div>
                        <div className={styles.stack}>
                            <Node title="Load balancer" sub={<>nginx / HAProxy · L4 or L7</>} accent="blue" groups={['req']} to="/guide/deployment">
                                <div className={styles.sub}>
                                    <div className={styles.subItem}>
                                        <span>WS</span>
                                        <M>X-Forwarded-For</M>
                                    </div>
                                    <div className={styles.subItem}>
                                        <span>TCP</span>
                                        <M>PROXY protocol v1/v2</M>
                                    </div>
                                </div>
                            </Node>
                            <Node
                                title="Real client IP"
                                sub={
                                    <>
                                        <M>trustProxy</M> → <M>ctx.request.ip</M>
                                    </>
                                }
                                accent="blue"
                                groups={['req']}
                                to="/guide/deployment"
                            />
                            <p className={styles.note}>
                                No per-layer routing at the edge — the TL layer is negotiated inside the encrypted
                                stream, so any replica fits.
                            </p>
                        </div>
                    </div>

                    {/* REPLICA FLEET */}
                    <div className={styles.col}>
                        <div className={clsx(styles.colHead, styles.tFleet)}>Replica fleet</div>
                        <div className={styles.fleet}>
                            <div className={styles.fleetTop}>
                                <span className={styles.badge}>app #1 · NODE_ID</span>
                                <span className={styles.note} style={{ margin: 0 }}>
                                    engine + handlers, one process
                                </span>
                            </div>
                            <div className={styles.stack}>
                                <Node
                                    title="Transport · framing"
                                    sub={<>WS + raw-TCP · abridged/intermediate/full/obfuscated</>}
                                    accent="green"
                                    groups={['req']}
                                    to="/internals/architecture"
                                />
                                <Node
                                    title="Crypto · handshake"
                                    sub={<>AES-IGE · msg_key v2 · RSA pin · DH</>}
                                    accent="green"
                                    groups={['req']}
                                    to="/internals/architecture"
                                />
                                <Node
                                    title="Sessions · auth keys"
                                    sub={<>salts · msg-id · seq · subject binding</>}
                                    accent="green"
                                    groups={['req', 'push']}
                                    to="/guide/sessions-auth"
                                />
                                <Node
                                    title="Dispatcher"
                                    sub={<>unwrap container / gzip · service vs business</>}
                                    accent="green"
                                    groups={['req']}
                                    to="/internals/architecture"
                                />
                                <Node
                                    title="TL codec · LayeredRegistry"
                                    sub={<>encode floored to the client's layer</>}
                                    accent="green"
                                    groups={['req']}
                                    to="/guide/releasing-a-version"
                                />
                                <Node
                                    title="Your handlers · core/"
                                    sub={
                                        <>
                                            rpc registry · hooks · <M>ctx</M> · errors — <M>InProcessForwarder</M>, no
                                            broker
                                        </>
                                    }
                                    accent="green"
                                    groups={['req', 'push']}
                                    to="/guide/adding-methods"
                                />
                                <Node
                                    title="Updates · server-push"
                                    sub={
                                        <>
                                            <M>ctx.push</M> · render per layer
                                        </>
                                    }
                                    accent="green"
                                    groups={['push']}
                                    to="/guide/adding-methods"
                                />
                            </div>
                            <div className={styles.layerRow}>
                                <span className={styles.ghostPod}>app #2</span>
                                <span className={styles.ghostPod}>app #3</span>
                                <span className={styles.ghostPod}>app #N</span>
                            </div>
                            <p className={styles.inproc}>scale = more replicas · any replica serves any client at any layer</p>
                        </div>
                    </div>

                    {/* SHARED STATE */}
                    <div className={styles.col}>
                        <div className={clsx(styles.colHead, styles.tState)}>Shared state</div>
                        <div className={styles.stack}>
                            <Node title="MongoDB" sub={<>durable · required for &gt; 1 replica</>} accent="green" groups={['req']} to="/guide/deployment">
                                <div className={styles.sub}>
                                    <div className={styles.subItem}>
                                        <M>authKeys</M>
                                        <span>subject · device · blocked</span>
                                    </div>
                                    <div className={styles.subItem}>
                                        <M>serverSalts</M>
                                        <span>rotating schedule</span>
                                    </div>
                                    <div className={styles.subItem}>
                                        <M>sessions</M>
                                        <span>layer · last activity</span>
                                    </div>
                                </div>
                            </Node>
                            <Node title="Redis" sub={<>ephemeral · live push</>} accent="teal" groups={['push']} to="/guide/deployment">
                                <div className={styles.sub}>
                                    <div className={styles.subItem}>
                                        <M>presence:{'{subject}'}</M>
                                        <span>→ nodeId · TTL</span>
                                    </div>
                                    <div className={styles.subItem}>
                                        <M>update bus</M>
                                        <span>pub/sub</span>
                                    </div>
                                </div>
                            </Node>
                            <p className={styles.note}>
                                Your app's business DB / services are separate — handlers own them. The engine creates
                                only these three collections.
                            </p>
                        </div>
                    </div>
                </div>

                {/* BOTTOM PANELS */}
                <div className={styles.panels}>
                    <Panel title="Request lifecycle" flow="req">
                        <ol className={styles.flow}>
                            <Step n="1" flow="req">
                                Client → replica: MTProto bytes (WS / raw-TCP)
                            </Step>
                            <Step n="2" flow="req">
                                Framing → decrypt — AES-IGE, <M>msg_key</M> v2 verified
                            </Step>
                            <Step n="3" flow="req">
                                <M>ensureSession</M> → Dispatcher (unwrap container / gzip)
                            </Step>
                            <Step n="4" flow="req">
                                service msg (ping, ack) handled inline · business → <M>InProcessForwarder</M>
                            </Step>
                            <Step n="5" kind="green" flow="req">
                                your handler runs in-process → result + effects (<M>bindUser</M> …)
                            </Step>
                            <Step n="6" flow="req">
                                encrypt at the client's layer → framing → bytes → client
                            </Step>
                            <Step n="!" kind="warn" flow="req">
                                pre-handler throws → <M>rpc_error</M> (BadRequest / AuthRequired / FloodWait)
                            </Step>
                        </ol>
                    </Panel>

                    <Panel title="Server-push flow" flow="push">
                        <ol className={styles.flow}>
                            <Step n="1" kind="green" flow="push">
                                handler <M>ctx.push</M> / <M>createUpdatePublisher</M>
                            </Step>
                            <Step n="2" flow="push">
                                publish → Redis bus (<M>updates.in</M>)
                            </Step>
                            <Step n="3" flow="push">
                                router: <M>presence.lookup(subject)</M> · throttle / coalesce
                            </Step>
                            <Step n="4" flow="push">
                                → <M>updates.node.{'{nodeId}'}</M> — only nodes holding the user
                            </Step>
                            <Step n="5" flow="push">
                                node: <M>registry.getBySubject</M> → render per layer
                            </Step>
                            <Step n="6" flow="push">
                                encrypted update → client (best-effort)
                            </Step>
                            <Step n="!" kind="warn" flow="push">
                                Redis down → drop → client resyncs via <M>getDifference</M> (pts)
                            </Step>
                        </ol>
                    </Panel>

                    <Panel title="Horizontal scaling model">
                        <ul className={styles.bullets}>
                            <li className={styles.bullet}>
                                <i>✓</i>
                                <span>
                                    <b>Uniform replicas:</b> all state in Mongo / Redis → any replica serves any client.
                                </span>
                            </li>
                            <li className={styles.bullet}>
                                <i>✓</i>
                                <span>
                                    <b>No broker:</b> engine + handlers in one process (<M>InProcessForwarder</M>).
                                </span>
                            </li>
                            <li className={styles.bullet}>
                                <i>✓</i>
                                <span>
                                    <b>Layers:</b> identical <M>schema/</M> + <M>schema/layers/</M> everywhere; encode
                                    floored to the client's layer.
                                </span>
                            </li>
                            <li className={styles.bullet}>
                                <i>✓</i>
                                <span>
                                    <b>Presence-routed push:</b> no broadcast fan-out; TTL expiry drains dead nodes.
                                </span>
                            </li>
                            <li className={styles.bullet}>
                                <i>✓</i>
                                <span>
                                    <b>Draining:</b> SIGTERM → stop carriers, drain per-conn queue; clients reconnect +{' '}
                                    <M>getDifference</M>.
                                </span>
                            </li>
                        </ul>
                    </Panel>
                </div>

                <div className={styles.legend}>
                    <span>
                        <span className={clsx(styles.dot, styles.aBlue)} /> client / edge path
                    </span>
                    <span>
                        <span className={clsx(styles.dot, styles.aGreen)} /> replica (engine + handlers)
                    </span>
                    <span>
                        <span className={clsx(styles.dot, styles.aTeal)} /> Redis live path
                    </span>
                    <span>hover a node or a flow step to trace it · click any box for the docs</span>
                </div>
            </div>
        </FocusCtx.Provider>
    )
}
