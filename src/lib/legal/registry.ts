import { createHash } from "node:crypto";
import type {
  LegalDocument,
  LegalDocumentKind,
  LegalDocumentSummary,
  LegalSection,
} from "@/types/legal";
import {
  legalFactTopics,
  legalFacts,
  type LegalFactKey,
  type LegalFacts,
} from "./facts";
import { privacyNoticeSections } from "./content/privacy-notice";
import { termsSections } from "./content/terms";

// Fase 5C.2 §5: single source of the current legal texts. A document is PUBLISHED only
// after legal review, with every operator fact defined and an effective date. Changing
// any text or fact requires a new version (tests pin each version to its content hash).
export type LegalPublication = {
  version: string;
  status: "DRAFT" | "PUBLISHED";
  /** YYYY-MM-DD, required to publish. */
  effectiveDate: string | null;
  /** Set only after the operator's legal review approves this exact version. */
  legalReviewApproved: boolean;
};

export const legalPublications: Record<LegalDocumentKind, LegalPublication> = {
  PRIVACY_NOTICE: {
    version: "aviso-privacidad-2026-10-borrador-1",
    status: "DRAFT",
    effectiveDate: null,
    legalReviewApproved: false,
  },
  TERMS: {
    version: "terminos-2026-10-borrador-1",
    status: "DRAFT",
    effectiveDate: null,
    legalReviewApproved: false,
  },
};

const definitions: Record<
  LegalDocumentKind,
  {
    slug: LegalDocument["slug"];
    title: string;
    requires: LegalFactKey[];
    sections: (facts: LegalFacts) => LegalSection[];
  }
> = {
  PRIVACY_NOTICE: {
    slug: "aviso-de-privacidad",
    title: "Aviso de Privacidad",
    requires: [
      "controller",
      "privacyContact",
      "retentionStatement",
      "providerDisclosure",
    ],
    sections: privacyNoticeSections,
  },
  TERMS: {
    slug: "terminos",
    title: "Términos y Condiciones",
    requires: ["controller", "termsContact", "governingLawAndJurisdiction"],
    sections: termsSections,
  },
};

export const legalDocumentKinds = Object.keys(
  definitions,
) as LegalDocumentKind[];

export class LegalPublicationError extends Error {}

export function hashLegalContent(
  document: Omit<LegalDocument, "contentHash" | "pendingTopics" | "status">,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        document.kind,
        document.locale,
        document.version,
        document.effectiveDate,
        document.title,
        document.sections,
      ]),
    )
    .digest("hex");
}

export function buildLegalDocument(
  kind: LegalDocumentKind,
  facts: LegalFacts = legalFacts,
  publication: LegalPublication = legalPublications[kind],
): LegalDocument {
  const definition = definitions[kind];
  const pendingTopics = [
    ...definition.requires
      .filter((key) => !facts[key])
      .map((key) => legalFactTopics[key]),
    ...(publication.effectiveDate ? [] : ["Fecha de entrada en vigor"]),
    ...(publication.legalReviewApproved
      ? []
      : ["Revisión jurídica y aprobación del texto"]),
  ];
  if (publication.status === "PUBLISHED" && pendingTopics.length)
    throw new LegalPublicationError(
      `${kind} cannot be published: ${pendingTopics.join("; ")}`,
    );
  const sections = [
    ...definition.sections(facts),
    {
      id: "version",
      title: "Versión y vigencia",
      paragraphs: [
        publication.status === "PUBLISHED"
          ? `Versión ${publication.version}, vigente a partir del ${publication.effectiveDate}.`
          : `Versión preliminar ${publication.version}. Este documento aún no está vigente: se publicará su versión definitiva antes de que ORBIT NEXUS opere en producción.`,
      ],
    },
  ];
  const document = {
    kind,
    slug: definition.slug,
    title: definition.title,
    locale: "es-MX" as const,
    version: publication.version,
    effectiveDate: publication.effectiveDate,
    sections,
  };
  return {
    ...document,
    status: publication.status,
    contentHash: hashLegalContent(document),
    pendingTopics: publication.status === "PUBLISHED" ? [] : pendingTopics,
  };
}

const current = new Map<LegalDocumentKind, LegalDocument>();
/** The current version of a legal document, as served to users. */
export function currentLegalDocument(kind: LegalDocumentKind) {
  let document = current.get(kind);
  if (!document) {
    document = buildLegalDocument(kind);
    current.set(kind, document);
  }
  return document;
}

export function legalDocumentSummary(
  document: LegalDocument,
): LegalDocumentSummary {
  const { sections: _sections, ...summary } = document;
  void _sections;
  return summary;
}

export function legalDocumentBySlug(slug: string) {
  const kind = legalDocumentKinds.find(
    (candidate) => definitions[candidate].slug === slug,
  );
  return kind ? currentLegalDocument(kind) : null;
}
