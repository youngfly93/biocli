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
});

/**
 * Parse an XML string into a JavaScript object using NCBI-tuned settings.
 *
 * @param xml  Raw XML response body from NCBI.
 * @returns    Parsed object tree.
 */
export function parseXml(xml: string): unknown {
  return defaultParser.parse(xml);
}
