import { Layout } from "../components/Layout.js";
import { NodeTable } from "../components/NodeTable.js";
import { useNodes } from "../hooks/useNodes.js";

export function Nodes() {
  const { nodes, loading, error } = useNodes();
  return (
    <Layout title="Nodes">
      {error && <p className="error-text">{error}</p>}
      {loading ? <p className="muted">Loading…</p> : <NodeTable nodes={nodes} />}
    </Layout>
  );
}
