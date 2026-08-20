export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

const DEFAULT_TEMPLATES = {
  scheduled: `Hello {{customerName}},

Your order from Bharath Cycle Hub has been scheduled for delivery.

Product: {{productName}}
Delivery Date: {{deliveryDate}}

Please share your delivery location on WhatsApp so our rider can reach you.

Thank you!
- Bharath Cycle Hub`,

  dispatched: `Hello {{customerName}},

Your {{productName}} is on the way!
{{#vehicleNo}}
Vehicle No: {{vehicleNo}}{{/vehicleNo}}{{#trackingLink}}
Track: {{trackingLink}}{{/trackingLink}}

Items:
{{lineItems}}

Free Accessories:
{{accessories}}

Thank you for choosing Bharath Cycle Hub!`,

  delivered: `Hello {{customerName}},

Thank you for your purchase from Bharath Cycle Hub!

We'd love to hear about your experience. Please leave us a review:
{{reviewLink}}

Thank you!
- Bharath Cycle Hub`,
};

export async function GET() {
  try {
    await requireFeature("whatsapp_templates", "view");

    const config = await prisma.alertConfig.findUnique({ where: { id: "singleton" } });
    const templates = (config?.whatsappTemplates as Record<string, string>) || {};

    return successResponse({
      scheduled: templates.scheduled || DEFAULT_TEMPLATES.scheduled,
      dispatched: templates.dispatched || DEFAULT_TEMPLATES.dispatched,
      delivered: templates.delivered || DEFAULT_TEMPLATES.delivered,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch templates", 500);
  }
}
