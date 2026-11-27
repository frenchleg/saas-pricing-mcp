// Wrangler bundles .html files as text modules (its default rules), so they import as strings.
declare module "*.html" {
  const content: string;
  export default content;
}
