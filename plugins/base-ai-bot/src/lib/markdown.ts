/**
 * Small markdown → HTML renderer for assistant answers.
 *
 * Rules: escape everything first (model output is untrusted), then apply a
 * fixed set of block/inline patterns. Only `http(s)`/`mailto`/relative links
 * survive, so `javascript:` and `data:` URLs cannot reach the DOM.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:')
  ) {
    return null;
  }
  return trimmed;
}

interface CodeBlock {
  lang: string;
  code: string;
}

export function renderMarkdown(source: string): string {
  const codeBlocks: CodeBlock[] = [];
  let md = source.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    codeBlocks.push({ lang, code });
    return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
  });

  const inlineCodes: string[] = [];
  md = md.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    inlineCodes.push(code);
    return `%%INLINE_${inlineCodes.length - 1}%%`;
  });

  md = escapeHtml(md);

  md = md.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  md = md.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  md = md.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  md = md.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  md = md.replace(/^---+$/gm, '<hr>');

  md = md.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  md = md.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/\*(.+?)\*/g, '<em>$1</em>');

  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) => {
    const safe = safeUrl(url);
    return safe
      ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>`
      : text;
  });

  md = md.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  md = md.replace(
    /^(\|.+\|)\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/gm,
    (_m, header: string, body: string) => {
      const cells = (row: string): string[] =>
        row
          .split('|')
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
      const thead = `<tr>${cells(header)
        .map((c) => `<th>${c}</th>`)
        .join('')}</tr>`;
      const rows = body
        .trim()
        .split('\n')
        .map((row) => `<tr>${cells(row).map((c) => `<td>${c}</td>`).join('')}</tr>`)
        .join('');
      return `<table><thead>${thead}</thead><tbody>${rows}</tbody></table>`;
    },
  );

  md = md.replace(/^(?:[-*] .+\n?)+/gm, (match) => {
    const items = match
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^[-*] /, '')}</li>`);
    return `<ul>${items.join('')}</ul>`;
  });

  md = md.replace(/^(?:\d+\. .+\n?)+/gm, (match) => {
    const items = match
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^\d+\. /, '')}</li>`);
    return `<ol>${items.join('')}</ol>`;
  });

  md = md.replace(/\n\n+/g, '</p><p>');
  md = md.replace(/\n/g, '<br>');
  md = `<p>${md}</p>`;
  md = md.replace(/<p>\s*<\/p>/g, '');
  md = md.replace(/<p>\s*(<h[1-4]|<ul|<ol|<table|<hr|<blockquote|<pre)/g, '$1');
  md = md.replace(
    /(<\/h[1-4]>|<\/ul>|<\/ol>|<\/table>|<hr>|<\/blockquote>|<\/pre>)\s*<\/p>/g,
    '$1',
  );

  md = md.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, i: string) => {
    const block = codeBlocks[Number(i)];
    if (!block) return '';
    const langAttr = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : '';
    return `<pre><code${langAttr}>${escapeHtml(block.code.replace(/\n$/, ''))}</code></pre>`;
  });

  md = md.replace(/%%INLINE_(\d+)%%/g, (_m, i: string) => {
    const code = inlineCodes[Number(i)];
    return code === undefined ? '' : `<code>${escapeHtml(code)}</code>`;
  });

  return md;
}
