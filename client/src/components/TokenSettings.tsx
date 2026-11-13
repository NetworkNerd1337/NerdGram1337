import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "./Modal";

type TokenMeta = {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "read-write";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not update tokens";
}

export function TokenSettings() {
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "read-write">("read");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = async () => {
    const listed = await api.listTokens();
    setTokens(listed.tokens);
  };

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(messageOf(err)));
  }, []);

  const pending = tokens.find((token) => token.id === confirmId);

  return (
    <section className="sync-card" id="tokens">
      <h2>Automation tokens</h2>
      <p>
        Scripts and CI call <code>/api/v1</code> with <code>Authorization: Bearer</code>.
        The browser UI does not use a token. A token is shown once. Read can list, search,
        lint, and render. Read-write can also create, update, move, and trash diagrams.
        Revoking a token stops it immediately. These tokens do not protect the browser
        routes, and the server still listens on loopback unless you set <code>HOST</code>.
      </p>
      {error ? <div className="error-banner">{error}</div> : null}
      {revealed ? (
        <div>
          <p>Copy this token now. NerdGram stores only a hash, so it cannot show the token again.</p>
          <p className="token-once">{revealed}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setRevealed(null)}>
              Hide
            </button>
          </div>
        </div>
      ) : null}
      <label htmlFor="token-name">Name</label>
      <input
        id="token-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder="CI render"
      />
      <label htmlFor="token-scope">Scope</label>
      <select id="token-scope" value={scope} onChange={(event) => setScope(event.target.value === "read-write" ? "read-write" : "read")}>
        <option value="read">Read</option>
        <option value="read-write">Read and write</option>
      </select>
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || name.trim().length < 1}
          onClick={() => {
            setBusy(true);
            setError(null);
            void api
              .createToken(name.trim(), scope)
              .then(async (created) => {
                setRevealed(created.token);
                setName("");
                await refresh();
              })
              .catch((err: unknown) => setError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          Create token
        </button>
      </div>
      {tokens.length === 0 ? <p>No tokens yet.</p> : null}
      {tokens.map((token) => (
        <div className="token-row" key={token.id}>
          <div>
            <strong>{token.name}</strong>
            <p>
              {token.prefix}… · {token.scope === "read-write" ? "read and write" : "read"}
              {token.revokedAt ? " · revoked" : ""}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || token.revokedAt != null}
            onClick={() => setConfirmId(token.id)}
          >
            Revoke
          </button>
        </div>
      ))}
      {pending ? (
        <Modal
          title={`Revoke ${pending.name}?`}
          confirmLabel="Revoke token"
          onClose={() => setConfirmId(null)}
          onConfirm={() => {
            const id = pending.id;
            setConfirmId(null);
            setBusy(true);
            setError(null);
            void api
              .revokeToken(id)
              .then(() => refresh())
              .catch((err: unknown) => setError(messageOf(err)))
              .finally(() => setBusy(false));
          }}
        >
          <p>
            {pending.name} ({pending.prefix}…) stops working immediately. This does not delete diagrams.
          </p>
        </Modal>
      ) : null}
    </section>
  );
}
