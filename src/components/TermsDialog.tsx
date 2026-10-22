import { useEffect, useRef } from 'react';
import { t, type Lang } from '../i18n';
import { parseTerms, termsFor, type Inline } from '../termsText';

const resolveHref = (href: string) => (/^[a-z]+:/i.test(href) ? href : `${import.meta.env.BASE_URL}${href}`);

function Text({ inline }: { inline: Inline[] }) {
  return <>{inline.map((part, i) => part.href
    ? <a key={i} href={resolveHref(part.href)} target="_blank" rel="noopener">{part.text}</a>
    : part.bold ? <strong key={i}>{part.text}</strong> : part.text)}</>;
}

/** The terms of use in a modal dialog, bundled with the app so they open offline. */
export default function TermsDialog({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const { text, translated } = termsFor(lang);
  return <dialog ref={ref} className="terms" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={t('Terms of use')}>
    {!translated && <p className="help">{t('The terms are shown in English for this language.')}</p>}
    {parseTerms(text).map((block, i) => block.kind === 'title'
      ? <h2 key={i}>{block.text}</h2>
      : <p key={i} className={block.kind === 'item' ? 'terms-item' : block.kind === 'quote' ? 'help' : undefined}>
        {block.kind === 'item' && <span>{block.n}.</span>}<Text inline={block.inline} />
      </p>)}
    <button type="button" onClick={onClose}>{t('Close')}</button>
  </dialog>;
}
