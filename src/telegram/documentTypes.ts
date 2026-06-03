const OCR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/tiff",
  "image/bmp",
  "application/pdf",
]);

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/xml",
  "text/css",
  "text/javascript",
  "text/x-python",
  "text/x-java-source",
  "text/x-c",
  "text/x-c++src",
  "text/x-shellscript",
  "text/x-ruby",
  "text/x-go",
  "text/x-rust",
  "text/x-typescript",
  "text/yaml",
  "text/x-log",
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/x-sh",
  "application/sql",
  "application/toml",
]);

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "log",
  "json", "yaml", "yml", "toml", "xml", "ini", "cfg", "conf",
  "html", "htm", "css", "js", "ts", "jsx", "tsx",
  "py", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp",
  "sh", "bash", "zsh", "fish",
  "sql", "graphql", "gql",
  "env", "gitignore", "dockerignore", "editorconfig",
  "tex", "bib", "rst", "org", "adoc",
  "diff", "patch",
  "makefile",
]);

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/tiff": "tiff",
  "image/bmp": "bmp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/html": "html",
  "text/css": "css",
  "text/javascript": "js",
  "text/x-python": "py",
  "text/x-java-source": "java",
  "text/x-c": "c",
  "text/x-c++src": "cpp",
  "text/x-shellscript": "sh",
  "text/x-ruby": "rb",
  "text/x-go": "go",
  "text/x-rust": "rs",
  "text/x-typescript": "ts",
  "text/yaml": "yaml",
  "text/xml": "xml",
  "text/x-log": "log",
  "application/json": "json",
  "application/xml": "xml",
  "application/x-yaml": "yaml",
  "application/x-sh": "sh",
  "application/sql": "sql",
  "application/toml": "toml",
};

export function classifyDocument(mimeType: string, filename?: string): "ocr" | "text" | null {
  if (OCR_MIME_TYPES.has(mimeType)) return "ocr";
  if (TEXT_MIME_TYPES.has(mimeType)) return "text";
  if (filename && isTextByExtension(filename)) return "text";
  return null;
}

export function extensionForDocument(mimeType: string, filename?: string): string {
  if (MIME_TO_EXTENSION[mimeType]) return MIME_TO_EXTENSION[mimeType];

  if (filename) {
    const parts = filename.split(".");
    if (parts.length > 1) return parts[parts.length - 1].toLowerCase();
  }

  return "bin";
}

function isTextByExtension(filename: string): boolean {
  const parts = filename.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return TEXT_EXTENSIONS.has(ext);
}
