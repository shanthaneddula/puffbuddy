"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

export default function ImporterPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_IMPORTER_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_IMPORTER_SUPABASE_ANON_KEY;
    return url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
  }, []);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [batchName, setBatchName] = useState("");
  const [urls, setUrls] = useState("");
  const [brandHints, setBrandHints] = useState("");
  const [familyHints, setFamilyHints] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setMessage(error.message);
      setSession(data?.session || null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const call = useCallback(async (body) => {
    if (!supabase) throw new Error("Importer environment variables are not configured.");
    const { data, error } = await supabase.functions.invoke("importer-workflow", { body });
    if (error) throw new Error(error.message || "Importer request failed.");
    if (data?.error) throw new Error(data.error);
    return data;
  }, [supabase]);

  const loadBatches = useCallback(async () => {
    if (!session) return;
    try {
      const data = await call({ action: "list_batches" });
      setBatches(data.batches || []);
    } catch (error) { setMessage(error.message); }
  }, [call, session]);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  async function signIn(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + "/importer" }
      });
      if (error) throw error;
      setMessage("Check your email for a secure sign-in link.");
    } catch (error) { setMessage(error.message || "Could not send sign-in link."); }
    finally { setBusy(false); }
  }

  async function createBatch(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const data = await call({
        action: "create_batch",
        name: batchName,
        urls: urls.split(/\\r?\\n/).map(x => x.trim()).filter(Boolean),
        brands: brandHints.split(",").map(x => x.trim()).filter(Boolean),
        families: familyHints.split(",").map(x => x.trim()).filter(Boolean)
      });
      setMessage((data.results || []).map(x => x.ok ? "Imported " + x.candidates_created + " candidate(s) from " + x.url : "Skipped " + x.url + ": " + x.error).join(" · "));
      setBatchName(""); setUrls(""); setBrandHints(""); setFamilyHints("");
      await loadBatches();
      await openBatch(data.batch_id);
    } catch (error) { setMessage(error.message || "Could not create batch."); }
    finally { setBusy(false); }
  }

  async function openBatch(id) {
    setBusy(true);
    try {
      const data = await call({ action: "get_batch", batch_id: id });
      setSelectedBatch(data.batch);
      setCandidates(data.candidates || []);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function review(candidate, status) {
    setBusy(true); setMessage("");
    try {
      await call({
        action: "review_candidate", candidate_id: candidate.id, status,
        product_name: candidate.product_name, brand: candidate.brand,
        normalized_payload: candidate.normalized_payload,
        review_notes: candidate.review_notes || ""
      });
      await openBatch(selectedBatch.id);
      await loadBatches();
      setMessage(status === "approved" ? "Candidate approved for export. It has not been published." : "Review saved.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  function updateCandidate(id, field, value) {
    setCandidates(current => current.map(c => {
      if (c.id !== id) return c;
      const next = { ...c, [field]: value };
      if (field === "product_name" || field === "brand") next.normalized_payload = { ...(c.normalized_payload || {}), [field === "product_name" ? "name" : "brand"]: value };
      return next;
    }));
  }

  function exportApproved() {
    const approved = candidates.filter(c => c.status === "approved").map(c => ({
      name: c.product_name, brand: c.brand, product_family: c.product_family,
      sku: c.sku, description: c.normalized_payload?.description || null,
      specs: {}, source_urls: (c.import_sources || []).map(s => s.canonical_url || s.source_url),
      image_candidates: (c.import_candidate_images || []).map(i => ({ url: i.image_url, rights_status: i.rights_status })),
      field_evidence: c.field_evidence
    }));
    if (!approved.length) { setMessage("Approve at least one candidate before exporting."); return; }
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), products: approved }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "puffbuddy-approved-import.json"; a.click();
    URL.revokeObjectURL(url);
    setMessage("Exported " + approved.length + " approved candidate(s). Review image rights and upload images before catalog publishing.");
  }

  if (loading) return <main className="importer-shell"><p>Loading importer…</p></main>;
  if (!supabase) return <main className="importer-shell"><h1>Importer setup required</h1><p>Preview-only importer environment variables are missing.</p></main>;
  if (!session) return <main className="importer-shell"><a href="/" className="importer-back">← Kiosk</a><section className="importer-login"><p className="importer-eyebrow">PUFFBUDDY / RESEARCH TOOLS</p><h1>Product importer</h1><p>Staff-only product research workspace. Sign in with the approved importer email.</p><form onSubmit={signIn}><label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label><button disabled={busy}>{busy ? "Sending…" : "Email sign-in link"}</button></form>{message && <p className="importer-message">{message}</p>}</section></main>;

  return <main className="importer-shell">
    <header className="importer-header"><div><p className="importer-eyebrow">PUFFBUDDY / STAFF TOOLS</p><h1>Product importer</h1><p>Research public product pages, inspect evidence, and approve candidates for handoff.</p></div><div><span>{session.user.email}</span><button className="importer-quiet" onClick={()=>supabase.auth.signOut()}>Sign out</button></div></header>
    {message && <div className="importer-message">{message}</div>}
    <section className="importer-grid">
      <div className="importer-panel">
        <p className="importer-eyebrow">01 / CREATE RESEARCH BATCH</p><h2>Import public product pages</h2>
        <p className="importer-muted">Paste up to five official manufacturer, brand, or distributor product-page URLs, one per line. The importer reads public page metadata and Schema.org product data.</p>
        <form onSubmit={createBatch}>
          <label>Batch name<input required maxLength="120" placeholder="Example: Geek Bar Pulse family" value={batchName} onChange={e=>setBatchName(e.target.value)} /></label>
          <label>Product page URLs<textarea required rows="5" placeholder="https://brand.com/products/model-one" value={urls} onChange={e=>setUrls(e.target.value)} /></label>
          <div className="importer-two"><label>Brand hints <small>Optional, comma separated</small><input value={brandHints} onChange={e=>setBrandHints(e.target.value)} placeholder="Geek Bar, Lost Mary" /></label><label>Product family hints <small>Optional</small><input value={familyHints} onChange={e=>setFamilyHints(e.target.value)} placeholder="Pulse, MT35000" /></label></div>
          <button disabled={busy}>{busy ? "Processing…" : "Research these URLs"}</button>
        </form>
        <div className="importer-notice"><b>Current no-cost mode</b><br/>Deterministic extraction from product structured data, headings, metadata, and page images. AI enrichment and broad web search are not enabled because no free provider credentials are configured.</div>
      </div>
      <div className="importer-panel">
        <p className="importer-eyebrow">02 / RESEARCH HISTORY</p><h2>Recent batches</h2>
        {batches.length === 0 ? <p className="importer-muted">No research batches yet.</p> : batches.map(batch=><button key={batch.id} className={"importer-batch " + (selectedBatch?.id === batch.id ? "active" : "")} onClick={()=>openBatch(batch.id)}><span><b>{batch.name}</b><small>{new Date(batch.created_at).toLocaleString()}</small></span><em>{batch.status}</em></button>)}
      </div>
    </section>
    {selectedBatch && <section className="importer-panel importer-results">
      <div className="importer-results-head"><div><p className="importer-eyebrow">03 / REVIEW CANDIDATES</p><h2>{selectedBatch.name}</h2><p className="importer-muted">{candidates.length} candidate(s) · approved candidates are not published automatically.</p></div><button className="importer-secondary" onClick={exportApproved}>Export approved JSON</button></div>
      {candidates.length === 0 ? <p className="importer-muted">No product candidates were extracted from this batch. Check the source URLs or try an official product page with Schema.org Product data.</p> : candidates.map(candidate=><article className="importer-candidate" key={candidate.id}>
        <div className="importer-candidate-top"><span className={"importer-status " + candidate.status}>{candidate.status.replace("_"," ")}</span><span>Extraction confidence: {Math.round((candidate.confidence || 0)*100)}% · not AI-verified</span></div>
        <div className="importer-candidate-fields"><label>Product name<input value={candidate.product_name || ""} onChange={e=>updateCandidate(candidate.id,"product_name",e.target.value)} /></label><label>Brand<input value={candidate.brand || ""} onChange={e=>updateCandidate(candidate.id,"brand",e.target.value)} /></label><label>SKU<input value={candidate.sku || ""} readOnly /></label></div>
        {candidate.normalized_payload?.description && <p className="importer-muted">{candidate.normalized_payload.description}</p>}
        {(candidate.import_candidate_images || []).length > 0 && <div className="importer-images">{candidate.import_candidate_images.map(img=><a key={img.id} href={img.image_url} target="_blank" rel="noreferrer"><img src={img.image_url} alt="Candidate product image" loading="lazy"/><small>Rights unverified</small></a>)}</div>}
        {(candidate.import_sources || []).map(source=><details key={source.id}><summary>Source evidence · {source.publisher || source.source_url}</summary><a href={source.canonical_url || source.source_url} target="_blank" rel="noreferrer">{source.source_title || source.source_url}</a><p>{(source.extracted_text || "").slice(0,1800)}{(source.extracted_text || "").length > 1800 ? "…" : ""}</p></details>)}
        <div className="importer-actions"><button disabled={busy || candidate.status === "approved"} onClick={()=>review(candidate,"approved")}>Approve for export</button><button className="importer-secondary" disabled={busy || candidate.status === "rejected"} onClick={()=>review(candidate,"rejected")}>Reject</button></div>
      </article>)}
    </section>}
    <p className="importer-footnote">Safety: submitted URLs are checked for private-network destinations, redirects and robots.txt restrictions. Only public HTML pages are processed. External image rights are not verified; do not publish an image until usage permission is confirmed. This tool does not write to the live kiosk catalog.</p>
  </main>;
}
