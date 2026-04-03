/**
 * XML parsing wrapper for NCBI responses.
 *
 * Uses fast-xml-parser with NCBI-specific configuration:
 *   - Attributes are preserved with '@_' prefix
 *   - Text nodes use '#text' key
 *   - Known NCBI elements that can repeat are always parsed as arrays
 *     (even when only a single element is present in the response)
 */

import { XMLParser } from 'fast-xml-parser';

/**
 * Set of NCBI XML element names that should always be parsed as arrays.
 *
 * When only a single child element exists, fast-xml-parser would normally
 * return it as a scalar. Listing these tags here ensures they are always
 * wrapped in an array, making downstream code simpler and more robust.
 */
const ARRAY_TAGS = new Set([
  // PubMed
  'PubmedArticle',
  'PubmedBookArticle',
  'Author',
  'MeshHeading',
  'Chemical',
  'PublicationType',
  'ArticleId',
  'Keyword',
  'Grant',
  'Reference',
  'ReferenceList',
  'AbstractText',
  'Affiliation',
  'AffiliationInfo',
  'Investigator',
  'DataBank',
  'AccessionNumber',
  'CommentsCorrections',

  // E-utilities generic
  'Id',
  'Item',
  'Link',
  'LinkSet',
  'IdList',
  'TranslationStack',
  'TranslationSet',
  'FieldList',

  // Gene / Nucleotide / Protein
  'Entrezgene',
  'GBSeq',
  'GBFeature',
  'GBQualifier',
  'GBReference',
  'GBAuthor',

  // GEO
  'Series',
  'Sample',
  'Platform',

  // SRA
  'EXPERIMENT_PACKAGE',
  'RUN',

  // Taxonomy
  'Taxon',
  'LineageEx',
]);

/**
 * Decode numeric HTML/XML character references: &#xHH; and &#DDD;
 *
 * fast-xml-parser decodes the standard 5 XML entities (&amp; &lt; &gt; &apos; &quot;)
 * but does NOT decode numeric character references (&#x144; &#946; etc.).
 * NCBI XML frequently uses these for accented characters in author names.
 */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16)),
  ).replace(/&#(\d+);/g, (_m, dec: string) =>
    String.fromCodePoint(parseInt(dec, 10)),
  );
}

/**
 * Inline markup tags that appear inside PubMed text fields.
 * Stripped from raw XML before parsing to prevent text loss.
 */
const INLINE_TAG_RE = /<\/?(i|b|u|sup|sub|em|strong|italic|bold)(\s[^>]*)?\/?>/gi;

const defaultParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (_name: string, _jPath: string, isLeafNode: boolean, isAttribute: boolean) => {
    if (isAttribute) return false;
    // Extract the tag name from the jPath (last segment)
    const tagName = _name;
    return ARRAY_TAGS.has(tagName);
  },
  trimValues: true,
  parseAttributeValue: true,
  parseTagValue: true,
  tagValueProcessor: (_tagName: string, tagValue: string) => {
    if (typeof tagValue === 'string') return decodeHtmlEntities(tagValue);
    return tagValue;
  },
  attributeValueProcessor: (_attrName: string, attrValue: string) => {
    if (typeof attrValue === 'string') return decodeHtmlEntities(attrValue);
    return attrValue;
  },
});

/**
 * Parse an XML string into a JavaScript object using NCBI-tuned settings.
 *
 * Pre-strips inline markup tags (<i>, <b>, <sup>, etc.) so their text
 * content is preserved in the parent element's #text node.
 *
 * @param xml  Raw XML response body from NCBI.
 * @returns    Parsed object tree.
 */
export function parseXml(xml: string): unknown {
  // Strip inline formatting tags before parsing to prevent text loss.
  // e.g. "The Role of<i>TP53</i>in cancer" → "The Role of TP53 in cancer"
  const cleaned = xml.replace(INLINE_TAG_RE, '');
  return defaultParser.parse(cleaned);
}
