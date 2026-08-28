"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

// The AWS setup instructions, inline, next to the fields they fill in.
//
// Step 3 is the one that matters most. A missing CORS policy fails the browser preflight,
// and fetch reports it as a generic network error with status 0 that names neither CORS nor
// the bucket — so people conclude uploads are broken rather than unconfigured. The Apply
// CORS button on the parent page does this for you; this text is the fallback for when the
// IAM user lacks s3:PutBucketCors.

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked in some contexts (insecure origin, permissions). The text is
      // visible and selectable either way, so this is not worth surfacing as an error.
      setCopied(false);
    }
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
        <button
          onClick={copy}
          className="text-[10px] text-blue-600 hover:text-blue-700 flex items-center gap-1 focus-ring rounded px-1 py-0.5"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="text-[10px] leading-relaxed bg-slate-900 text-slate-100 rounded-lg p-2.5 overflow-x-auto">
        {text}
      </pre>
    </div>
  );
}

const IAM_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AppObjectAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    },
    {
      "Sid": "AllowTheApplyCorsButton",
      "Effect": "Allow",
      "Action": ["s3:PutBucketCors"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET"
    }
  ]
}`;

const CORS_POLICY = `[
  {
    "AllowedOrigins": ["https://your-app-domain"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 86400
  }
]`;

const BUCKET_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicRead",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
  }]
}`;

export function SetupGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] bg-slate-50 focus-ring"
      >
        <span className="text-xs font-semibold text-slate-700">
          How to set up an AWS S3 bucket
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {open && (
        <div className="p-4 space-y-4 text-[11px] text-slate-600 leading-relaxed">
          <section>
            <p className="text-xs font-semibold text-slate-900">1. Create the bucket</p>
            <p className="mt-0.5">
              S3 → Create bucket. The <strong>region matters</strong> — it becomes part of the
              endpoint, so it must match the Region field exactly.{" "}
              <code className="bg-slate-100 px-1 rounded">ap-south-1</code> is Mumbai.
            </p>
          </section>

          <section>
            <p className="text-xs font-semibold text-slate-900">2. Create an IAM user</p>
            <p className="mt-0.5">
              IAM → Users → Create user → Attach policies directly → Create inline policy →
              JSON. Then create an access key of type <em>Application running outside AWS</em>{" "}
              and paste the two values into the form above.
            </p>
            <CopyBlock label="IAM policy" text={IAM_POLICY} />
            <p className="mt-1 text-slate-500">
              The second statement is only needed for the <strong>Apply CORS</strong> button.
              Leave it out and set CORS by hand in step 3.
            </p>
          </section>

          <section>
            <p className="text-xs font-semibold text-slate-900">
              3. CORS — the step that silently breaks uploads
            </p>
            <p className="mt-0.5">
              The browser uploads directly to the bucket, so the bucket must allow it. Without
              this, uploads fail at the preflight and the browser reports only a generic
              network error that never mentions CORS.
            </p>
            <p className="mt-1">
              Use the <strong>Apply CORS</strong> button above. If your IAM user lacks{" "}
              <code className="bg-slate-100 px-1 rounded">s3:PutBucketCors</code>, paste this
              under Bucket → Permissions → CORS instead.
            </p>
            <CopyBlock label="CORS configuration" text={CORS_POLICY} />
          </section>

          <section>
            <p className="text-xs font-semibold text-slate-900">4. Make files readable</p>
            <p className="mt-0.5">
              Photos are shown by URL, so stored objects must be publicly readable. Either put
              CloudFront in front of the bucket (recommended — cheaper egress and a custom
              domain), or turn off Block Public Access and attach this policy.
            </p>
            <CopyBlock label="Public read bucket policy" text={BUCKET_POLICY} />
            <p className="mt-1">
              Put the resulting domain in <strong>Public base URL</strong>. That value is stored
              with every uploaded file, so setting it now means you can move to CloudFront later
              without rewriting a single database row.
            </p>
          </section>

          <section>
            <p className="text-xs font-semibold text-slate-900">5. Test, then activate</p>
            <p className="mt-0.5">
              <strong>Test connection</strong> writes a small object, reads it back and deletes
              it. Only when that passes does <strong>Make active</strong> switch new uploads
              over. Files already stored stay where they are and keep working.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
