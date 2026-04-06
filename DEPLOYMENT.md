# Deploying to S3, CloudFront and Lambda

This repo uses GitHub Actions to deploy the static site to S3, invalidate the CloudFront distribution, and update the Omnisend form Lambda on every push to `main`.

## 1. AWS setup

### S3 bucket

1. Create an S3 bucket (e.g. `modulus-media-website`).
2. **Block public access**: turn off “Block all public access” only if you plan to use S3 website hosting; for CloudFront you typically keep the bucket private and allow access only via an Origin Access Control (OAC) or Origin Access Identity (OAI).
3. Recommended: leave the bucket private and use CloudFront as the only public entry point.

### CloudFront distribution

1. Create a CloudFront distribution.
2. **Origin**: set the origin domain to your S3 bucket (e.g. `your-bucket.s3.us-east-1.amazonaws.com` or S3 website endpoint if you use website hosting).
2. If the bucket is private: create an Origin Access Control (OAC), attach it to the CloudFront distribution, and add a bucket policy that allows CloudFront to read from the bucket (use the policy snippet AWS provides in the console).
3. **Default root object**: set to `index.html`.
4. **Alternate domain names (CNAMEs)**: add your custom domain (e.g. `www.modulusmedia.co.za`) if you use one.
5. After creation, note the **Distribution ID** (e.g. `E1ABC2DEF3GHI`).

### IAM OIDC identity provider and role (no access keys)

We use **OpenID Connect (OIDC)** so GitHub Actions can assume an IAM role. No long-lived AWS keys are stored in GitHub.

#### 1. Add GitHub as an OIDC identity provider in AWS

1. In the AWS Console go to **IAM → Identity providers → Add provider**.
2. **Provider type**: OpenID Connect.
3. **Provider URL**: `https://token.actions.githubusercontent.com`
4. **Audience**: `sts.amazonaws.com` (default).
5. Click **Add provider**.

#### 2. Create an IAM role for GitHub Actions

1. **IAM → Roles → Create role**.
2. **Trusted entity type**: Web identity.
3. **Identity provider**: choose `token.actions.githubusercontent.com`.
4. **Audience**: `sts.amazonaws.com`.
5. Under **Conditions** (optional but recommended), add a condition so only this repo can assume the role:
   - Condition key: `token.actions.githubusercontent.com:sub`
   - Operator: StringEquals
   - Value: `repo:YOUR-GITHUB-ORG/YOUR-REPO-NAME:ref:refs/heads/main`  
     (Replace with your org/username and repo name. To allow any branch, use `repo:YOUR-ORG/YOUR-REPO:*`.)
6. Click **Next**, then attach a policy.

#### 3. Attach permissions to the role

Create an inline policy (or a custom managed policy) and attach it to this role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME",
        "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation"
      ],
      "Resource": "arn:aws:cloudfront::YOUR-AWS-ACCOUNT-ID:distribution/YOUR-DISTRIBUTION-ID"
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:GetFunction"
      ],
      "Resource": "arn:aws:lambda:YOUR-AWS-REGION:YOUR-AWS-ACCOUNT-ID:function:YOUR-LAMBDA-FUNCTION-NAME"
    }
  ]
}
```

Replace:

- `YOUR-BUCKET-NAME` with your S3 bucket name.
- `YOUR-AWS-ACCOUNT-ID` with your 12-digit AWS account ID.
- `YOUR-DISTRIBUTION-ID` with your CloudFront distribution ID.
- `YOUR-AWS-REGION` with your Lambda region (e.g. `us-east-1`).
- `YOUR-LAMBDA-FUNCTION-NAME` with the name of your Omnisend form Lambda (see `lambda/omnisend-form/README.md`).

4. Name the role (e.g. `GitHubActions-ModulusWebsite-Deploy`) and create it.
5. Copy the **Role ARN** (e.g. `arn:aws:iam::123456789012:role/GitHubActions-ModulusWebsite-Deploy`). You’ll add it as a GitHub variable.

## 2. GitHub variables (no secrets needed for AWS)

In your GitHub repo: **Settings → Secrets and variables → Actions → Variables**.

No AWS access keys are required. Configure these **variables**:

| Variable                       | Description                                          | Example        |
|--------------------------------|------------------------------------------------------|----------------|
| `AWS_REGION`                   | AWS region of the S3 bucket and Lambda.              | `us-east-1`    |
| `S3_BUCKET`                    | S3 bucket name used for the website.                 | `modulus-media-website` |
| `CLOUDFRONT_DISTRIBUTION_ID`   | CloudFront distribution ID.                         | `E1ABC2DEF3GHI`|
| `AWS_ROLE_ARN`                 | ARN of the IAM role created above (for OIDC).       | `arn:aws:iam::123456789012:role/GitHubActions-ModulusWebsite-Deploy` |
| `LAMBDA_FUNCTION_NAME`         | Name of the Omnisend form Lambda (deployed from `lambda/omnisend-form`). | `omnisend-form` |

You can set these at the **repository** level or per **environment** (see below).

#### Environments (branch-based)

The workflow uses GitHub **Environments** based on the branch:

- **Production** — used when the workflow runs from the `main` branch.
- **Staging** — used when the workflow is run manually from another branch.

Create these in **Settings → Environments** (add `Production` and optionally `Staging`). You can then define environment-specific variables or protection rules (e.g. required reviewers for Production). If you don’t create them, GitHub will create the environment the first time the workflow uses it.

## 3. Deploy

- **Automatic**: push or merge to the `main` branch. The workflow runs with the **Production** environment, syncs files to S3, invalidates CloudFront, and deploys the Lambda (`lambda/omnisend-form`).
- **Manual**: open the **Actions** tab, select **Deploy to S3, CloudFront and Lambda**, and run the workflow. If you run from `main`, the **Production** environment is used; from any other branch, **Staging** is used.

## 4. Custom domain (optional)

- In CloudFront, add your domain under **Alternate domain names** and attach an ACM certificate (request/validate the cert in `us-east-1` if this is your first cert for CloudFront).
- In your DNS (e.g. Route 53 or your registrar), add a CNAME (or A/AAAA with alias) pointing the domain to the CloudFront distribution domain name.
