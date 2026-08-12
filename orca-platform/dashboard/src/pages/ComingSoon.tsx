import { Layout } from "../components/Layout.js";

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <Layout title={title}>
      <div className="card">
        <p>{title} isn't backed by a real subsystem yet.</p>
        <p className="muted">Coming in {phase} — see orca-platform/docs/PROGRESS.md for status.</p>
      </div>
    </Layout>
  );
}
