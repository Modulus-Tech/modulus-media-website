/**
 * Lambda: form submission → Omnisend contact (tag: advertiser | landowner).
 * Invoked via API Gateway (HTTP API or REST API).
 *
 * Env: OMNISEND_API_KEY (required)
 */

const OMNISEND_API_URL = 'https://api.omnisend.com/v3/contacts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, ...headers },
    body: JSON.stringify(body),
  };
}

function parseName(fullName) {
  const s = (fullName || '').trim();
  const i = s.lastIndexOf(' ');
  if (i <= 0) return { firstName: s || 'Subscriber', lastName: '' };
  return {
    firstName: s.slice(0, i).trim() || 'Subscriber',
    lastName: s.slice(i + 1).trim(),
  };
}

/**
 * Build Omnisend contact payload: identifiers, name, phone, tag, custom fields.
 */
function buildOmnisendBody(formType, data) {
  const email = (data['Email Address'] || data.email || '').trim().toLowerCase();
  const fullName = data['Full Name'] || data.fullName || '';
  const phone = (data['Phone'] || data.phone || '').trim() || undefined;

  const { firstName, lastName } = parseName(fullName);

  const tag = formType === 'advertiser' ? 'advertiser' : 'landowner';

  const reserved = new Set(['formType', 'Full Name', 'Email Address', 'Phone', 'email', 'fullName', 'phone', 'botcheck']);
  const customProperties = {};
  for (const [key, value] of Object.entries(data)) {
    if (reserved.has(key) || value === undefined || value === null) continue;
    const v = typeof value === 'string' ? value.trim() : value;
    if (v === '') continue;
    customProperties[key] = v;
  }

  const identifiers = [
    {
      type: 'email',
      id: email,
      channels: {
        email: {
          status: 'subscribed',
          statusDate: new Date().toISOString(),
        },
      },
    },
  ];
  if (phone) {
    identifiers.push({
      type: 'phone',
      id: phone.replace(/\D/g, ''),
      channels: {
        // Omnisend allowed values: subscribed, nonSubscribed, unsubscribed
        sms: { status: 'nonSubscribed' },
      },
    });
  }

  const body = {
    identifiers,
    firstName,
    lastName,
    tags: [tag],
    ...(Object.keys(customProperties).length > 0 && { customProperties }),
  };

  return body;
}

export async function handler(event) {
  console.log('Incoming event summary', {
    hasBody: !!event.body,
    isBase64Encoded: !!event.isBase64Encoded,
    contentType: event.headers && (event.headers['content-type'] || event.headers['Content-Type']),
  });

  if (event.requestContext?.http?.method === 'OPTIONS') {
    return jsonResponse(204, null);
  }

  const apiKey = process.env.OMNISEND_API_KEY;
  if (!apiKey) {
    console.error('OMNISEND_API_KEY is not set');
    return jsonResponse(500, { success: false, message: 'Server configuration error' });
  }

  let data;
  try {
    let raw = event.body;
    console.log('Raw body type', typeof raw);

    if (raw == null) {
      data = {};
    } else if (typeof raw === 'object' && !Array.isArray(raw)) {
      data = raw;
    } else {
      const str = typeof raw === 'string' ? (event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw) : String(raw);
      data = JSON.parse(str || '{}');
      if (typeof data === 'string') data = JSON.parse(data);
    }
    // If API Gateway or another proxy wrapped the body, unwrap it
    if (!('formType' in data || 'formtype' in data) && typeof data.body === 'string') {
      try {
        const inner = JSON.parse(data.body);
        if (inner && typeof inner === 'object') {
          data = inner;
        }
      } catch {
        // ignore and keep original data
      }
    }
    console.log('Parsed data snapshot', {
      keys: Object.keys(data || {}),
      formTypeRaw: data && (data.formType ?? data.formtype),
    });
  } catch {
    console.error('Body parse error', { raw: event.body });
    return jsonResponse(400, { success: false, message: 'Invalid JSON body' });
  }

  const formType = (data.formType ?? data.formtype ?? '').toString().trim().toLowerCase();
  console.log('Computed formType', formType);
  if (formType !== 'advertiser' && formType !== 'landowner') {
    return jsonResponse(400, { success: false, message: 'formType must be "advertiser" or "landowner"' });
  }

  const email = (data['Email Address'] || data.email || '').trim().toLowerCase();
  if (!email) {
    return jsonResponse(400, { success: false, message: 'Email is required' });
  }

  const omnisendBody = buildOmnisendBody(formType, data);

  try {
    const res = await fetch(OMNISEND_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(omnisendBody),
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }

    if (!res.ok) {
      console.error('Omnisend API error', res.status, text);
      return jsonResponse(502, {
        success: false,
        message: parsed.message || `Omnisend error (${res.status})`,
      });
    }

    return jsonResponse(200, { success: true });
  } catch (err) {
    console.error('Omnisend request failed', err);
    return jsonResponse(502, { success: false, message: 'Unable to complete signup. Please try again.' });
  }
}
