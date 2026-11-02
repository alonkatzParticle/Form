// productBrands — which brand each product belongs to.
// Assignments live in settings.productBrands ({ "Face Cream": "Particle", ... }), shared by both boards.
// A product with no assignment belongs to the brand field's default value (Particle).
// Product fields opt in with "brandField": "brand" in settings.json.

// Attach the assignments to every brand-aware field, so the form can filter its options
// from the field definition alone.
export function attachProductBrands(settings) {
  const assignments = settings.productBrands ?? {};
  return (settings.boards ?? []).map((board) => ({
    ...board,
    fields: (board.fields ?? []).map((f) => {
      if (!f.brandField) return f;
      const brandField = board.fields.find((b) => b.key === f.brandField);
      return { ...f, optionBrands: assignments, defaultBrand: brandField?.defaultValue ?? "" };
    }),
  }));
}

// The brand a product belongs to.
export function brandOf(field, option) {
  return field.optionBrands?.[option] ?? field.defaultBrand;
}

// Only the options that belong to the selected brand (an empty brand counts as the default).
export function optionsForBrand(field, options, brand) {
  if (!field.brandField) return options;
  const selected = brand || field.defaultBrand;
  return options.filter((o) => brandOf(field, o) === selected);
}
