-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_ref" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address_json" JSONB,
    "service_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "asset_ref" TEXT NOT NULL,
    "property_id" UUID NOT NULL,
    "unit_id" UUID,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "make" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "installed_at" DATE,
    "warranty_expires_at" DATE,
    "criticality" TEXT NOT NULL DEFAULT 'medium',
    "condition" TEXT NOT NULL DEFAULT 'good',
    "status" TEXT NOT NULL DEFAULT 'active',
    "service_interval_days" INTEGER,
    "last_serviced_at" DATE,
    "next_service_at" DATE,
    "notes" TEXT,
    "disposed_at" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "request_ref" TEXT NOT NULL,
    "property_id" UUID NOT NULL,
    "unit_id" UUID,
    "tenant_id" UUID,
    "asset_id" UUID,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "source" TEXT NOT NULL DEFAULT 'staff',
    "requester_name" TEXT NOT NULL,
    "requester_contact" TEXT,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target_date" DATE,
    "triaged_at" TIMESTAMPTZ,
    "decided_at" TIMESTAMPTZ,
    "decision_reason" TEXT,
    "completed_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "closed_by" UUID,
    "assigned_manager_membership_id" UUID,
    "resolution_notes" TEXT,
    "feedback_rating" INTEGER,
    "feedback_comment" TEXT,
    "escalated_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_updates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "body" TEXT NOT NULL,
    "author_user_id" UUID,
    "author_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "work_order_ref" TEXT NOT NULL,
    "maintenance_request_id" UUID,
    "pm_plan_id" UUID,
    "pm_due_date" DATE,
    "kind" TEXT NOT NULL DEFAULT 'reactive',
    "property_id" UUID NOT NULL,
    "unit_id" UUID,
    "asset_id" UUID,
    "category" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigned_user_id" UUID,
    "vendor_id" UUID,
    "assigned_at" TIMESTAMPTZ,
    "scheduled_at" DATE,
    "due_at" DATE,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "closed_by" UUID,
    "labour_cost_minor" INTEGER NOT NULL DEFAULT 0,
    "materials_cost_minor" INTEGER NOT NULL DEFAULT 0,
    "vendor_cost_minor" INTEGER NOT NULL DEFAULT 0,
    "other_cost_minor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "purchase_reference" TEXT,
    "completion_notes" TEXT,
    "checklist_json" JSONB,
    "sign_off_name" TEXT,
    "sign_off_notes" TEXT,
    "return_visit_date" DATE,
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preventive_maintenance_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "plan_name" TEXT NOT NULL,
    "interval_days" INTEGER NOT NULL,
    "next_due_at" DATE NOT NULL,
    "lead_days" INTEGER NOT NULL DEFAULT 7,
    "checklist_json" JSONB NOT NULL DEFAULT '[]',
    "assigned_vendor_id" UUID,
    "assigned_user_id" UUID,
    "estimated_cost_minor" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_generated_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "preventive_maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendors_organization_id_status_idx" ON "vendors"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_organization_id_vendor_ref_key" ON "vendors"("organization_id", "vendor_ref");

-- CreateIndex
CREATE INDEX "assets_organization_id_property_id_idx" ON "assets"("organization_id", "property_id");

-- CreateIndex
CREATE INDEX "assets_organization_id_next_service_at_idx" ON "assets"("organization_id", "next_service_at");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organization_id_asset_ref_key" ON "assets"("organization_id", "asset_ref");

-- CreateIndex
CREATE INDEX "maintenance_requests_organization_id_status_idx" ON "maintenance_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_requests_tenant_id_idx" ON "maintenance_requests"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_organization_id_request_ref_key" ON "maintenance_requests"("organization_id", "request_ref");

-- CreateIndex
CREATE INDEX "maintenance_updates_request_id_created_at_idx" ON "maintenance_updates"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "work_orders_organization_id_status_idx" ON "work_orders"("organization_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_assigned_user_id_status_idx" ON "work_orders"("assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_vendor_id_idx" ON "work_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "work_orders_asset_id_idx" ON "work_orders"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_pm_plan_id_pm_due_date_key" ON "work_orders"("pm_plan_id", "pm_due_date");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_organization_id_work_order_ref_key" ON "work_orders"("organization_id", "work_order_ref");

-- CreateIndex
CREATE INDEX "preventive_maintenance_plans_organization_id_active_next_du_idx" ON "preventive_maintenance_plans"("organization_id", "active", "next_due_at");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assigned_manager_membership_id_fkey" FOREIGN KEY ("assigned_manager_membership_id") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_maintenance_request_id_fkey" FOREIGN KEY ("maintenance_request_id") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_pm_plan_id_fkey" FOREIGN KEY ("pm_plan_id") REFERENCES "preventive_maintenance_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventive_maintenance_plans" ADD CONSTRAINT "preventive_maintenance_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventive_maintenance_plans" ADD CONSTRAINT "preventive_maintenance_plans_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventive_maintenance_plans" ADD CONSTRAINT "preventive_maintenance_plans_assigned_vendor_id_fkey" FOREIGN KEY ("assigned_vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventive_maintenance_plans" ADD CONSTRAINT "preventive_maintenance_plans_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Integrity rules for facilities (services validate first; these are the last line of defence) ──
ALTER TABLE work_orders ADD CONSTRAINT work_orders_costs_nonneg CHECK (
  labour_cost_minor >= 0 AND materials_cost_minor >= 0 AND vendor_cost_minor >= 0 AND other_cost_minor >= 0);
ALTER TABLE work_orders ADD CONSTRAINT work_orders_due_after_scheduled CHECK (due_at IS NULL OR scheduled_at IS NULL OR due_at >= scheduled_at);
ALTER TABLE work_orders ADD CONSTRAINT work_orders_preventive_has_plan CHECK (kind <> 'preventive' OR pm_plan_id IS NOT NULL);
ALTER TABLE preventive_maintenance_plans ADD CONSTRAINT pm_interval_positive CHECK (interval_days BETWEEN 1 AND 3660);
ALTER TABLE preventive_maintenance_plans ADD CONSTRAINT pm_lead_nonneg CHECK (lead_days BETWEEN 0 AND 365);
ALTER TABLE preventive_maintenance_plans ADD CONSTRAINT pm_single_assignee CHECK (assigned_vendor_id IS NULL OR assigned_user_id IS NULL);
ALTER TABLE assets ADD CONSTRAINT assets_interval_positive CHECK (service_interval_days IS NULL OR service_interval_days > 0);
ALTER TABLE maintenance_requests ADD CONSTRAINT mr_feedback_range CHECK (feedback_rating IS NULL OR feedback_rating BETWEEN 1 AND 5);

-- Work orders carry the cost history used in maintenance reporting: never hard-delete them (cancel instead).
CREATE TRIGGER work_orders_no_delete BEFORE DELETE ON work_orders FOR EACH ROW EXECUTE FUNCTION aipos_forbid_delete();
