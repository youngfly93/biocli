/**
 * Pipeline step: xml-parse — parse XML strings into JSON objects.
 *
 * Uses fast-xml-parser (same as the fetch step's auto-detection path)
 * for explicit XML parsing when the data hasn't been auto-parsed yet.
 */

import type { HttpContext } from '../../types.js';

/**
 * Parse an XML string into a JavaScript object.
 * If data is already parsed (not a string), returns it unchanged.
 */
export async function handleXmlParse(
  _ctx: HttpContext | null,
  _params: unknown,
  data: unknown,
  _args: Record<string, unknown>,
): Promise<unknown> {
  if (typeof data === 'string') {
    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      isArray: (
        _name: string,
        _jpath: string,
        isLeafNode: boolean,
        isAttribute: boolean,
      ) => {
        if (isAttribute || isLeafNode) return false;
        return false;
      },
    });
    return parser.parse(data);
  }
  return data; // already parsed
}
