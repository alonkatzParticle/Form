// ProductBrandsEditor — Settings page for assigning each product to a brand.
// Products come from every brand-aware field ("brandField" in settings.json) on both boards;
// brands come from that brand field's options. Saved to settings.productBrands, which the
// form uses to show only the selected brand's products.
// A product with no saved assignment belongs to the brand field's default (Particle).

import { useState, useEffect } from "react";
import axios from "axios";

export default function ProductBrandsEditor() {
  const [products,    setProducts]    = useState([]);  // [{ name, boards: ["Video Projects", ...] }]
  const [brands,      setBrands]      = useState([]);
  const [defaultBrand, setDefaultBrand] = useState("");
  const [assignments, setAssignments] = useState({});
  const [search,      setSearch]      = useState("");
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState(null);
  const [dirty,       setDirty]       = useState(false);

  useEffect(() => {
    axios.get("/api/settings")
      .then(({ data }) => {
        const byName = new Map();
        let brandOptions = [];
        let fallback = "";
        for (const board of data.boards ?? []) {
          for (const field of board.fields ?? []) {
            if (!field.brandField) continue;
            const brandField = board.fields.find((f) => f.key === field.brandField);
            if (brandField && !brandOptions.length) {
              brandOptions = brandField.options ?? [];
              fallback = brandField.defaultValue ?? "";
            }
            for (const name of field.options ?? []) {
              if (!byName.has(name)) byName.set(name, []);
              byName.get(name).push(board.label);
            }
          }
        }
        setProducts([...byName].map(([name, boards]) => ({ name, boards })).sort((a, b) => a.name.localeCompare(b.name)));
        setBrands(brandOptions);
        setDefaultBrand(fallback);
        setAssignments(data.productBrands ?? {});
      })
      .catch(() => setSaveMsg("Error — could not load products."))
      .finally(() => setLoading(false));
  }, []);

  const brandOf = (name) => assignments[name] ?? defaultBrand;

  function assign(name, brand) {
    setAssignments((prev) => ({ ...prev, [name]: brand }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true); setSaveMsg(null);
    try {
      // Save every product explicitly so nothing depends on the default afterwards
      const all = Object.fromEntries(products.map((p) => [p.name, brandOf(p.name)]));
      const { data } = await axios.put("/api/settings/product-brands", { productBrands: all });
      setAssignments(data.productBrands);
      setDirty(false);
      setSaveMsg("Saved!");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setSaveMsg("Error: " + (err.response?.data?.error || "save failed."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="tr-page"><p className="ut-hint">Loading…</p></div>;

  const visible = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const counts = Object.fromEntries(brands.map((b) => [b, products.filter((p) => brandOf(p.name) === b).length]));

  return (
    <div className="tr-page">
      <div className="tr-header">
        <div className="ut-section-title">Products by Brand</div>
        <p className="ut-hint">
          Pick the brand each product belongs to. In the form, the Product dropdown only lists products
          for the brand selected in Step 1. Products added from the form are assigned to the brand
          that was selected; products added directly in Monday start as <strong>{defaultBrand}</strong>.
        </p>
        <p className="ut-hint">
          {brands.map((b) => `${b}: ${counts[b]}`).join(" · ")}
        </p>
      </div>

      <div className="ar-run-row" style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: 320, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 14 }}
        />
        <button className="ef-save-btn" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
        {saveMsg && (
          <span className={`ef-save-msg${saveMsg.startsWith("Error") ? " ef-save-msg--err" : ""}`}>{saveMsg}</span>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 12 }}>
              <th style={{ padding: "6px 8px" }}>Product</th>
              <th style={{ padding: "6px 8px" }}>Boards</th>
              <th style={{ padding: "6px 8px" }}>Brand</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.name} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 8px", color: "var(--text)" }}>{p.name}</td>
                <td style={{ padding: "6px 8px", color: "var(--text-muted)", fontSize: 12 }}>{p.boards.join(", ")}</td>
                <td style={{ padding: "6px 8px" }}>
                  <select
                    value={brandOf(p.name)}
                    onChange={(e) => assign(p.name, e.target.value)}
                    style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13 }}
                  >
                    {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
