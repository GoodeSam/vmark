import type { LinkInfo } from "@/plugins/shared/toolbarContextTypes";

export interface LinkPopupPayload {
  href: string;
  linkFrom: number;
  linkTo: number;
}

export function resolveLinkPopupPayload(
  selection: { from: number; to: number },
  linkContext?: LinkInfo | null
): LinkPopupPayload | null {
  if (linkContext) {
    return {
      href: linkContext.href,
      linkFrom: linkContext.from,
      linkTo: linkContext.to,
    };
  }

  if (selection.from === selection.to) return null;

  return {
    href: "",
    linkFrom: selection.from,
    linkTo: selection.to,
  };
}
