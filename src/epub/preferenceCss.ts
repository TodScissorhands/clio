import { DOCUMENT_THEMES } from "../reader/appearance";
import type { EpubPreferences } from "./preferences";

const PROTECTED_CONTENT = "pre,code,kbd,samp,table,svg,math,img,picture,video,audio,canvas,iframe,object,embed,form,input,textarea,select,button";
const PROTECTED_BLOCKS = `${PROTECTED_CONTENT},[epub|type~="verse"],[epub|type~="poem"],[epub|type~="z3998:verse"],[epub|type~="z3998:poem"],[epub|type~="z3998:stanza"],[epub|type~="z3998:linegroup"],.verse,.poetry,.poem,.stanza,.linegroup,.manual-break,.manualbreak,.preformatted,.preserve-whitespace,[data-preserve-whitespace],[style*="white-space" i]`;
// Preserve Clio's bounded ordinary-paragraph exception; no descendant CSS normalization.
const PROSE = `p:not(:is(${PROTECTED_BLOCKS})):not(:is(${PROTECTED_BLOCKS}) *):not(:has(br,${PROTECTED_CONTENT}))`;
const COLOR_TEXT = "p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,figcaption,span,em,strong,b,i,small,sub,sup,mark,abbr,cite,q,s,u,del,ins";
const COLOR_SURFACES = "pre,code,kbd,samp,table,thead,tbody,tfoot,tr,th,td,caption";

// A per-document size variable lets Foliate share CSS while chapters retain
// their own publisher baseline.
export function epubPreferenceCss(preferences: EpubPreferences): string {
  const rules: string[] = [];
  const prose: string[] = [];
  if (preferences.fontScale !== null) {
    prose.push("font-size:var(--clio-prose-size)!important");
  }
  if (preferences.fontFamily !== "publisher") prose.push("font-family:inherit!important");
  if (preferences.lineHeight !== null) prose.push(`line-height:${preferences.lineHeight}!important`);
  if (preferences.alignment !== "publisher") prose.push(`text-align:${preferences.alignment}!important`);
  if (prose.length) rules.push(`${PROSE}{${prose.join(";")}}`);
  const theme = DOCUMENT_THEMES.find(entry => entry.id === preferences.theme);
  if (theme?.background && theme.foreground) {
    const { background, foreground } = theme;
    rules.push(
      `html,body{background-color:${background}!important;color:${foreground}!important}`,
      `:is(${COLOR_TEXT}):not(svg *):not(math *){color:${foreground}!important;background-color:transparent!important}`,
      `${COLOR_SURFACES}{color:${foreground}!important;background-color:${background}!important}`,
      `a,a:link,a:visited{color:${foreground}!important;text-decoration:underline!important}`,
      `::selection{color:${background}!important;background-color:${foreground}!important}`,
    );
  }
  return rules.length ? `@namespace epub "http://www.idpf.org/2007/ops";\n${rules.join("\n")}` : "";
}
