# Omnisend form Lambda

This Lambda receives form submissions from the website (via API Gateway), then creates or updates a contact in Omnisend with the appropriate tag (`advertiser` or `landowner`) and all form fields as custom properties.

## Environment variable

| Variable | Required | Description |
|----------|----------|-------------|
| `OMNISEND_API_KEY` | Yes | Omnisend API key (Store Settings → API in Omnisend). |

## Request (from API Gateway)

- **Method**: `POST`
- **Content-Type**: `application/json`
- **Body**: JSON with:
  - `formType`: `"advertiser"` or `"landowner"`
  - Form fields by name as sent from the site, typically `"Full Name"`, `"Email Address"`, and optionally `"Phone"`. Any additional keys are stored as Omnisend custom properties (with known labels mapped in the Lambda).

Example:

```json
{
  "formType": "landowner",
  "Full Name": "Jane Doe",
  "Email Address": "jane@example.com",
  "Phone": "+27 71 123 4567"
}
```

## Response

- **200**: `{ "success": true }`
- **400**: Validation error, e.g. missing `formType` or email
- **502**: Omnisend API error or network failure

CORS headers are included so the browser can call the API from your site.

## Deploying the Lambda and API Gateway

### 1. Package and create the Lambda function

1. Zip the handler:
   ```bash
   cd lambda/omnisend-form
   zip -r function.zip index.mjs
   ```
2. In AWS Console: **Lambda → Create function**.
   - Runtime: **Node.js 24.x**.
   - Create a new role with basic Lambda permissions (or use an existing one).
3. **Upload** the `function.zip` (Code → Upload from → .zip file).
4. **Configuration → General configuration**: set Handler to `index.handler`.
5. **Configuration → Environment variables**: add `OMNISEND_API_KEY` with your Omnisend API key.

### 2. Create the API Gateway HTTP API

1. **API Gateway → Create API** → **HTTP API** (Build).
2. **Add integration**: Integration type **Lambda**, select your Lambda, give it a name (e.g. `OmnisendForm`).
3. **Add route**: Method `POST`, path e.g. `/submit`, attach the Lambda integration.
4. **CORS** (if your site is on a different domain): Configure **Access-Control-Allow-Origin** for your site (or `*` for testing). The Lambda already returns CORS headers; you may still need to allow the method and headers in API Gateway.
5. Note the **Invoke URL** (e.g. `https://abc123xyz.execute-api.us-east-1.amazonaws.com`).

### 3. Wire the frontend to your API

In `index.html`, set `FORM_API_URL` to your API Gateway URL plus the route, for example:

```javascript
const FORM_API_URL = 'https://abc123xyz.execute-api.us-east-1.amazonaws.com/submit';
```

If you use a **stage** (e.g. `prod`), include it in the path:

```javascript
const FORM_API_URL = 'https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/submit';
```

Redeploy the static site (e.g. via your GitHub Actions workflow) after changing this URL.

### 4. (Optional) Restrict CORS

In API Gateway, set CORS to your production domain only instead of `*` when you go live.

### 5. (Optional) Add API key or usage plan

To reduce abuse, you can add an API Gateway usage plan and API key, or protect the route with a custom header or WAF. The Lambda does not validate an API key by default.
