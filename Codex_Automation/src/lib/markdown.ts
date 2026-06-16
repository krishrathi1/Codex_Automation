/**
 * Lightweight Markdown renderer
 * Preserves the same logic as the original app.js renderMarkdown function
 */

interface CodeBlock {
  html: string;
  language: string;
  code: string;
}

export function renderMarkdown(text: string): string {
  if (!text) return '';

  // 1. Escape HTML
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Extract code blocks and store them in an array
  const codeBlocks: CodeBlock[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)(?:```|$)/g, (_match, lang, code) => {
    const language = lang ? lang.trim() : 'code';
    const cleanCode = code.replace(/\n$/, '');
    const index = codeBlocks.length;

    const blockHtml = `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-block-lang">${language}</span>
        <button class="copy-code-btn" type="button" data-code-index="${index}">Copy</button>
      </div>
      <pre><code class="language-${language}">${cleanCode}</code></pre>
    </div>`;

    codeBlocks.push({ html: blockHtml, language, code: cleanCode });
    return `\n__CODE_BLOCK_PLACEHOLDER_${index}__\n`;
  });

  // 3. Inline formatting (bold, italic, inline code)
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 4. Parse paragraphs and lists
  const lines = html.split('\n');
  let inList = false;
  const processedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('__CODE_BLOCK_PLACEHOLDER_') && trimmed.endsWith('__')) {
      if (inList) {
        inList = false;
        processedLines.push('</ul>');
      }
      processedLines.push(trimmed);
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.substring(2);
      if (!inList) {
        inList = true;
        processedLines.push('<ul class="markdown-list">');
      }
      processedLines.push(`<li>${content}</li>`);
    } else {
      if (inList) {
        inList = false;
        processedLines.push('</ul>');
      }
      if (trimmed === '') {
        processedLines.push('<br>');
      } else {
        processedLines.push(`<p class="markdown-para">${line}</p>`);
      }
    }
  }

  if (inList) {
    processedLines.push('</ul>');
  }

  let finalHtml = processedLines.join('\n');

  // 5. Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    finalHtml = finalHtml.replace(`__CODE_BLOCK_PLACEHOLDER_${i}__`, codeBlocks[i].html);
  }

  return finalHtml;
}

export function extractCodeFromBlock(index: number, rawText: string): string {
  const regex = /```(\w*)\n([\s\S]*?)(?:```|$)/g;
  let match;
  let currentIndex = 0;
  while ((match = regex.exec(rawText)) !== null) {
    if (currentIndex === index) {
      return match[2].replace(/\n$/, '');
    }
    currentIndex++;
  }
  return '';
}
