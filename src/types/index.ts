import { Database } from './database.types';

export * from './database.types';

// Convenience Type Aliases
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];

// Entity-specific types
export type Department = Tables<'departments'>;
export type User = Tables<'users'>;
export type JobOrder = Tables<'job_orders'>;
export type MaterialRequisition = Tables<'material_requisitions'>;
export type MRSLineItem = Tables<'mrs_line_items'>;
export type TransmittalForm = Tables<'transmittal_forms'>;
export type ActivityLog = Tables<'activity_logs'>;
export type ItemPriceCatalog = Tables<'item_price_catalog'>;
export type Attachment = Tables<'attachments'>;
export type PMSAsset = Tables<'pms_assets'>;
export type PMSActivityLog = Tables<'pms_activity_logs'>;
export type NumberSequence = Tables<'number_sequences'>;
export type SystemSetting = Tables<'system_settings'>;

// Enums
export type UserRole = Enums<'user_role'>;
export type AccountStatus = Enums<'account_status'>;
export type JOPriority = Enums<'jo_priority'>;
export type JOStatus = Enums<'jo_status'>;
export type MRSType = Enums<'mrs_type'>;
export type MRSStatus = Enums<'mrs_status'>;
export type TransmittalType = Enums<'transmittal_type'>;
export type TransmittalStatus = Enums<'transmittal_status'>;
export type ItemDeliveryStatus = Enums<'item_delivery_status'>;
export type PMSInterval = Enums<'pms_interval'>;
export type AssetCategory = Enums<'asset_category'>;
export type PhotoContext = Enums<'photo_context'>;
