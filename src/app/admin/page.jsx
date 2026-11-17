"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";

export default function Admin() {
  const [supabase] = useState(() => getSupabase());
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ name: "", brand: "", series: "", description: "", category_id: "", highlights: "", specs: "" });
  const [image, setImage] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setMessage(error.message);
      setSession(data?.session || null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  const loadAdminData = useCallback(async () => {
    if (!session?.user) { setIsAdmin(null); setAdminLoading(false); return; }
    setAdminLoading(true);
    const { data, error } = await supabase.from("admin_users").select("user_id").eq("user_id", session.user.id).maybeSingle();
    if (error) { setIsAdmin(null); setMessage("Could not verify staff access: " + error.message); setAdminLoading(false); return; }
    if (!data) { setIsAdmin(false); setAdminLoading(false); return; }
    setIsAdmin(true);
    const [cats, items] = await Promise.all([
      supabase.from("categories").select("*").order("sort_order"),
      supabase.from("products").select("*, categories(name)").order("created_at", { ascending: false })
    ]);
    if (cats.error || items.error) setMessage(cats.error?.message || items.error?.message);
    setCategories(cats.data || []);
    setProducts(items.data || []);
    setAdminLoading(false);
  }, [session, supabase]);

  useEffect(() => { loadAdminData(); }, [loadAdminData]);

  async function sendLogin(e) {
    e.preventDefault(); setMessage("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + "/admin" } });
    setMessage(error ? error.message : "Check your email for a secure sign-in link.");
  }

  async function saveProduct(e) {
    e.preventDefault();
    if (!supabase || !isAdmin) return;
    setSaving(true); setMessage("");
    try {
      let image_url = null;
      if (image) {
        const ext = image.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = "products/" + crypto.randomUUID() + "." + ext;
        const { error: uploadError } = await supabase.storage.from("puffbuddy-product-images").upload(path, image, { upsert: false, contentType: image.type });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from("puffbuddy-product-images").getPublicUrl(path);
        image_url = data.publicUrl;
      }
      let specs = {};
      if (form.specs.trim()) specs = JSON.parse(form.specs);
      if (!specs || Array.isArray(specs) || typeof specs !== "object") throw new Error("Specifications must be a JSON object.");
      const payload = {
        name: form.name.trim(), brand: form.brand.trim() || null, series: form.series.trim() || null,
        description: form.description.trim() || null, category_id: form.category_id || null,
        highlights: form.highlights.split("\n").map(x => x.trim()).filter(Boolean),
        specs, image_url, is_active: true
      };
      const { error } = await supabase.from("products").insert(payload);
      if (error) throw error;
      setMessage("Product added to the catalog.");
      setForm({ name: "", brand: "", series: "", description: "", category_id: categories[0]?.id || "", highlights: "", specs: "" });
      setImage(null);
      await loadAdminData();
    } catch (err) { setMessage(err.message || "Could not save product."); }
    finally { setSaving(false); }
  }

  async function toggleProduct(product) {
    const { error } = await supabase.from("products").update({ is_active: !product.is_active }).eq("id", product.id);
    if (error) setMessage(error.message); else await loadAdminData();
  }

  if (authLoading) return <main className="admin-shell"><p>Checking sign-in…</p></main>;
  if (!supabase) return <main className="admin-shell"><h1>Staff console</h1><p>Supabase environment variables are missing. Configure them in the deployment settings.</p></main>;
  if (!session) return <main className="admin-shell"><a className="back-link" href="/">← Back to kiosk</a><div className="admin-card"><p className="eyebrow">PUFFBUDDY STAFF</p><h1>Sign in</h1><p className="muted">Enter your approved staff email to receive a secure sign-in link.</p><form onSubmit={sendLogin}><label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="primary wide">Email me a sign-in link</button></form>{message && <p className="form-message">{message}</p>}</div></main>;
  if (adminLoading || isAdmin === null) return <main className="admin-shell"><p>Verifying staff access…</p>{message && <p className="form-message">{message}</p>}</main>;
  if (!isAdmin) return <main className="admin-shell"><div className="admin-card"><h1>Access not approved</h1><p>Your account is signed in, but it is not on the staff allowlist.</p><button className="secondary" onClick={()=>supabase.auth.signOut()}>Sign out</button></div></main>;

  return <main className="admin-shell"><header className="admin-head"><div><p className="eyebrow">PUFFBUDDY / STAFF</p><h1>Catalog manager</h1></div><div><a className="back-link" href="/">View kiosk ↗</a><button className="text-button" onClick={()=>supabase.auth.signOut()}>Sign out</button></div></header>
    {message && <p className="form-message">{message}</p>}
    <div className="admin-layout"><form className="admin-card" onSubmit={saveProduct}><p className="eyebrow">ADD TO CATALOG</p><h2>New product</h2>
      <label>Product name<input required maxLength="160" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <div className="two-fields"><label>Brand<input value={form.brand} onChange={e=>setForm({...form,brand:e.target.value})}/></label><label>Series / model<input value={form.series} onChange={e=>setForm({...form,series:e.target.value})}/></label></div>
      <label>Category<select value={form.category_id} onChange={e=>setForm({...form,category_id:e.target.value})}><option value="">Select category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Description<textarea rows="3" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <label>Highlights <small>(one per line)</small><textarea rows="3" value={form.highlights} onChange={e=>setForm({...form,highlights:e.target.value})}/></label>
      <label>Specifications <small>(JSON object, optional)</small><textarea rows="3" placeholder={'{"Capacity":"...","Battery":"..."}'} value={form.specs} onChange={e=>setForm({...form,specs:e.target.value})}/></label>
      <label>Actual product image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setImage(e.target.files?.[0] || null)}/><small>JPEG, PNG or WebP. Keep uploads under 10 MB.</small></label>
      <button className="primary wide" disabled={saving}>{saving ? "Saving…" : "Add product"}</button>
    </form><section className="admin-card"><p className="eyebrow">LIVE CATALOG</p><h2>{products.length} products</h2>{products.map(p=><div className="admin-product" key={p.id}><img src={p.image_url || "/product-placeholder.svg"} alt=""/><div><b>{p.name}</b><small>{p.brand || "No brand"} · {p.categories?.name || "Uncategorized"}</small><small>{p.is_active ? "Visible on kiosk" : "Hidden from kiosk"}</small></div><button className="secondary small" onClick={()=>toggleProduct(p)}>{p.is_active ? "Hide" : "Show"}</button></div>)}</section></div>
  </main>;
}
