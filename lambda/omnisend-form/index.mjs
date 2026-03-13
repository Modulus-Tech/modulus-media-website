/**
 * Lambda: form submission → Omnisend contact (tag: advertiser | landowner).
 * Invoked via API Gateway (HTTP API or REST API).
 *
 * Env: OMNISEND_API_KEY (required)
 */

const OMNISEND_API_URL = 'https://api.omnisend.com/v3/contacts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*.modulusmedia.co.za',
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
        sms: { status: 'non_subscribed' },
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
    const raw = typeof event.body === 'string' ? event.body : (event.body && JSON.stringify(event.body));
    data = JSON.parse(raw || '{}');
  } catch {
    return jsonResponse(400, { success: false, message: 'Invalid JSON body' });
  }

  const formType = (data.formType || '').toLowerCase();
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
