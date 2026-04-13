/**
 * FilePreview — shows a summary of files attached to a task in the review stage.
 *
 * Props:
 *   fileFields  — board.fields filtered to type === "file"
 *   entryFiles  — { [fieldKey]: FileList | File[] }
 */

import { useEffect, useState } from "react";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileThumb({ file }) {
  const [url, setUrl] = useState(null);
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  useEffect(() => {
    if (!isImage && !isVideo) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage, isVideo]);

  return (
    <div className="file-preview-thumb">
      {isImage && url ? (
        <img src={url} alt={file.name} className="file-preview-img" />
      ) : isVideo && url ? (
        <video src={url} className="file-preview-video" muted playsInline preload="metadata" />
      ) : (
        <div className="file-preview-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
      )}
      <div className="file-preview-name" title={file.name}>{file.name}</div>
      <div className="file-preview-size">{formatBytes(file.size)}</div>
    </div>
  );
}

export default function FilePreview({ fileFields = [], entryFiles = {} }) {
  const sections = fileFields
    .map((f) => {
      const files = entryFiles[f.key];
      const list = files ? Array.from(files) : [];
      return { label: f.label, files: list };
    })
    .filter((s) => s.files.length > 0);

  if (sections.length === 0) return null;

  return (
    <div className="file-preview-wrap">
      <div className="file-preview-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        <span>Attached Files</span>
      </div>
      {sections.map(({ label, files }) => (
        <div key={label} className="file-preview-section">
          {sections.length > 1 && (
            <div className="file-preview-field-label">{label}</div>
          )}
          <div className="file-preview-grid">
            {files.map((file, i) => (
              <FileThumb key={i} file={file} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
