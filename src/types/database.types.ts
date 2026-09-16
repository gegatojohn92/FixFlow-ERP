export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      departments: {
        Row: {
          id: number
          department_name: string
        }
        Insert: {
          id?: number
          department_name: string
        }
        Update: {
          id?: number
          department_name?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: Database["public"]["Enums"]["user_role"]
          department_id: number
          account_status: Database["public"]["Enums"]["account_status"]
          created_by: string | null
          last_login_at: string | null
          deactivated_at: string | null
          created_at: string | null
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role?: Database["public"]["Enums"]["user_role"]
          department_id: number
          account_status?: Database["public"]["Enums"]["account_status"]
          created_by?: string | null
          last_login_at?: string | null
          deactivated_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: Database["public"]["Enums"]["user_role"]
          department_id?: number
          account_status?: Database["public"]["Enums"]["account_status"]
          created_by?: string | null
          last_login_at?: string | null
          deactivated_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      job_orders: {
        Row: {
          id: number
          jo_number: string
          revision_suffix: number
          location: string
          title: string
          description: string
          priority: Database["public"]["Enums"]["jo_priority"]
          status: Database["public"]["Enums"]["jo_status"]
          site_photo_url: string | null
          requester_id: string
          assignee_id: string | null
          reopen_count: number
          is_emergency_fast_track: boolean
          started_at: string | null
          completed_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          jo_number: string
          revision_suffix?: number
          location: string
          title: string
          description: string
          priority?: Database["public"]["Enums"]["jo_priority"]
          status?: Database["public"]["Enums"]["jo_status"]
          site_photo_url?: string | null
          requester_id: string
          assignee_id?: string | null
          reopen_count?: number
          is_emergency_fast_track?: boolean
          started_at?: string | null
          completed_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          jo_number?: string
          revision_suffix?: number
          location?: string
          title?: string
          description?: string
          priority?: Database["public"]["Enums"]["jo_priority"]
          status?: Database["public"]["Enums"]["jo_status"]
          site_photo_url?: string | null
          requester_id?: string
          assignee_id?: string | null
          reopen_count?: number
          is_emergency_fast_track?: boolean
          started_at?: string | null
          completed_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      material_requisitions: {
        Row: {
          id: number
          mrs_number: string
          request_type: Database["public"]["Enums"]["mrs_type"]
          jo_id: number | null
          department_id: number
          requester_id: string
          purpose: string
          is_online_purchase: boolean
          online_tracking_number: string | null
          est_shipping_fee: number
          actual_shipping_fee: number
          online_supplier_url: string | null
          revolving_fund_used: boolean
          manager_status: string
          manager_rejection_reason: string | null
          manager_reviewed_at: string | null
          total_estimated_cost: number
          allocated_budget: number
          total_actual_spent: number
          spare_change_amount: number
          budget_variance_amount: number
          owner_status: string
          owner_rejection_reason: string | null
          owner_reviewed_at: string | null
          delivery_status: string
          requester_verification: string
          verification_notes: string | null
          verified_at: string | null
          overall_status: Database["public"]["Enums"]["mrs_status"]
          is_emergency_fast_track: boolean
          fast_track_cap_amount: number
          fast_track_audited_at: string | null
          fast_track_audited_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          mrs_number: string
          request_type: Database["public"]["Enums"]["mrs_type"]
          jo_id?: number | null
          department_id: number
          requester_id: string
          purpose: string
          is_online_purchase?: boolean
          online_tracking_number?: string | null
          est_shipping_fee?: number
          actual_shipping_fee?: number
          online_supplier_url?: string | null
          revolving_fund_used?: boolean
          manager_status?: string
          manager_rejection_reason?: string | null
          manager_reviewed_at?: string | null
          total_estimated_cost?: number
          allocated_budget?: number
          total_actual_spent?: number
          spare_change_amount?: number
          budget_variance_amount?: number
          owner_status?: string
          owner_rejection_reason?: string | null
          owner_reviewed_at?: string | null
          delivery_status?: string
          requester_verification?: string
          verification_notes?: string | null
          verified_at?: string | null
          overall_status?: Database["public"]["Enums"]["mrs_status"]
          is_emergency_fast_track?: boolean
          fast_track_cap_amount?: number
          fast_track_audited_at?: string | null
          fast_track_audited_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          mrs_number?: string
          request_type?: Database["public"]["Enums"]["mrs_type"]
          jo_id?: number | null
          department_id?: number
          requester_id?: string
          purpose?: string
          is_online_purchase?: boolean
          online_tracking_number?: string | null
          est_shipping_fee?: number
          actual_shipping_fee?: number
          online_supplier_url?: string | null
          revolving_fund_used?: boolean
          manager_status?: string
          manager_rejection_reason?: string | null
          manager_reviewed_at?: string | null
          total_estimated_cost?: number
          allocated_budget?: number
          total_actual_spent?: number
          spare_change_amount?: number
          budget_variance_amount?: number
          owner_status?: string
          owner_rejection_reason?: string | null
          owner_reviewed_at?: string | null
          delivery_status?: string
          requester_verification?: string
          verification_notes?: string | null
          verified_at?: string | null
          overall_status?: Database["public"]["Enums"]["mrs_status"]
          is_emergency_fast_track?: boolean
          fast_track_cap_amount?: number
          fast_track_audited_at?: string | null
          fast_track_audited_by?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_requisitions_jo_id_fkey"
            columns: ["jo_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_requisitions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_requisitions_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_requisitions_fast_track_audited_by_fkey"
            columns: ["fast_track_audited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      mrs_line_items: {
        Row: {
          id: number
          mrs_id: number
          item_description: string
          qty_requested: number
          qty_fulfilled: number
          qty_issued_from_stock: number
          unit: string
          reference_photo_url: string | null
          store_name: string | null
          est_unit_price: number
          actual_unit_price: number
          vendor_rating: number
          is_overpriced: boolean
          item_delivery_status: Database["public"]["Enums"]["item_delivery_status"]
          purchased_at: string | null
        }
        Insert: {
          id?: number
          mrs_id: number
          item_description: string
          qty_requested: number
          qty_fulfilled?: number
          qty_issued_from_stock?: number
          unit: string
          reference_photo_url?: string | null
          store_name?: string | null
          est_unit_price?: number
          actual_unit_price?: number
          vendor_rating?: number
          is_overpriced?: boolean
          item_delivery_status?: Database["public"]["Enums"]["item_delivery_status"]
          purchased_at?: string | null
        }
        Update: {
          id?: number
          mrs_id?: number
          item_description?: string
          qty_requested?: number
          qty_fulfilled?: number
          qty_issued_from_stock?: number
          unit?: string
          reference_photo_url?: string | null
          store_name?: string | null
          est_unit_price?: number
          actual_unit_price?: number
          vendor_rating?: number
          is_overpriced?: boolean
          item_delivery_status?: Database["public"]["Enums"]["item_delivery_status"]
          purchased_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mrs_line_items_mrs_id_fkey"
            columns: ["mrs_id"]
            isOneToOne: false
            referencedRelation: "material_requisitions"
            referencedColumns: ["id"]
          }
        ]
      }
      transmittal_forms: {
        Row: {
          id: number
          transmittal_number: string
          mrs_id: number | null
          batch_code: string | null
          transmittal_type: Database["public"]["Enums"]["transmittal_type"]
          amount: number
          sender_user_id: string
          sender_status: Database["public"]["Enums"]["transmittal_status"]
          sent_at: string | null
          receiver_user_id: string
          receiver_status: Database["public"]["Enums"]["transmittal_status"]
          received_at: string | null
          courier_tracking_barcode: string | null
          notes: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          transmittal_number: string
          mrs_id?: number | null
          batch_code?: string | null
          transmittal_type: Database["public"]["Enums"]["transmittal_type"]
          amount: number
          sender_user_id: string
          sender_status?: Database["public"]["Enums"]["transmittal_status"]
          sent_at?: string | null
          receiver_user_id: string
          receiver_status?: Database["public"]["Enums"]["transmittal_status"]
          received_at?: string | null
          courier_tracking_barcode?: string | null
          notes?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          transmittal_number?: string
          mrs_id?: number | null
          batch_code?: string | null
          transmittal_type?: Database["public"]["Enums"]["transmittal_type"]
          amount?: number
          sender_user_id?: string
          sender_status?: Database["public"]["Enums"]["transmittal_status"]
          sent_at?: string | null
          receiver_user_id?: string
          receiver_status?: Database["public"]["Enums"]["transmittal_status"]
          received_at?: string | null
          courier_tracking_barcode?: string | null
          notes?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transmittal_forms_mrs_id_fkey"
            columns: ["mrs_id"]
            isOneToOne: false
            referencedRelation: "material_requisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transmittal_forms_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transmittal_forms_receiver_user_id_fkey"
            columns: ["receiver_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      activity_logs: {
        Row: {
          id: number
          entity_type: string
          entity_id: number
          action: string
          jo_id: number | null
          mrs_id: number | null
          transmittal_id: number | null
          reference_code: string
          details_notes: string | null
          performed_by: string
          timestamp: string | null
        }
        Insert: {
          id?: number
          entity_type: string
          entity_id: number
          action: string
          jo_id?: number | null
          mrs_id?: number | null
          transmittal_id?: number | null
          reference_code: string
          details_notes?: string | null
          performed_by: string
          timestamp?: string | null
        }
        Update: {
          id?: number
          entity_type?: string
          entity_id?: number
          action?: string
          jo_id?: number | null
          mrs_id?: number | null
          transmittal_id?: number | null
          reference_code?: string
          details_notes?: string | null
          performed_by?: string
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_jo_id_fkey"
            columns: ["jo_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_mrs_id_fkey"
            columns: ["mrs_id"]
            isOneToOne: false
            referencedRelation: "material_requisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_transmittal_id_fkey"
            columns: ["transmittal_id"]
            isOneToOne: false
            referencedRelation: "transmittal_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      item_price_catalog: {
        Row: {
          id: number
          item_description: string
          store_name: string
          last_unit_price: number
          is_overpriced_flag: boolean
          overpriced_flag_count: number
          last_purchased_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          item_description: string
          store_name: string
          last_unit_price: number
          is_overpriced_flag?: boolean
          overpriced_flag_count?: number
          last_purchased_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          item_description?: string
          store_name?: string
          last_unit_price?: number
          is_overpriced_flag?: boolean
          overpriced_flag_count?: number
          last_purchased_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      attachments: {
        Row: {
          id: number
          context: Database["public"]["Enums"]["photo_context"]
          entity_type: string
          entity_id: number
          file_url: string
          uploaded_by: string
          uploaded_at: string | null
        }
        Insert: {
          id?: number
          context: Database["public"]["Enums"]["photo_context"]
          entity_type: string
          entity_id: number
          file_url: string
          uploaded_by: string
          uploaded_at?: string | null
        }
        Update: {
          id?: number
          context?: Database["public"]["Enums"]["photo_context"]
          entity_type?: string
          entity_id?: number
          file_url?: string
          uploaded_by?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      pms_assets: {
        Row: {
          id: number
          asset_name: string
          category: Database["public"]["Enums"]["asset_category"]
          location: string
          interval_type: Database["public"]["Enums"]["pms_interval"]
          interval_custom_months: number | null
          last_performed_date: string | null
          next_due_date: string
          is_aircon: boolean
          created_at: string | null
        }
        Insert: {
          id?: number
          asset_name: string
          category: Database["public"]["Enums"]["asset_category"]
          location: string
          interval_type: Database["public"]["Enums"]["pms_interval"]
          interval_custom_months?: number | null
          last_performed_date?: string | null
          next_due_date: string
          is_aircon?: boolean
          created_at?: string | null
        }
        Update: {
          id?: number
          asset_name?: string
          category?: Database["public"]["Enums"]["asset_category"]
          location?: string
          interval_type?: Database["public"]["Enums"]["pms_interval"]
          interval_custom_months?: number | null
          last_performed_date?: string | null
          next_due_date?: string
          is_aircon?: boolean
          created_at?: string | null
        }
        Relationships: []
      }
      pms_activity_logs: {
        Row: {
          id: number
          asset_id: number
          performed_by: string
          checklist_json: Json
          freon_pressure_psi: number | null
          compressor_amperage: number | null
          performed_at: string | null
        }
        Insert: {
          id?: number
          asset_id: number
          performed_by: string
          checklist_json: Json
          freon_pressure_psi?: number | null
          compressor_amperage?: number | null
          performed_at?: string | null
        }
        Update: {
          id?: number
          asset_id?: number
          performed_by?: string
          checklist_json?: Json
          freon_pressure_psi?: number | null
          compressor_amperage?: number | null
          performed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pms_activity_logs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "pms_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pms_activity_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      number_sequences: {
        Row: {
          entity_prefix: string
          year: number
          last_value: number
        }
        Insert: {
          entity_prefix: string
          year: number
          last_value?: number
        }
        Update: {
          entity_prefix?: string
          year?: number
          last_value?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      next_reference_number: {
        Args: {
          p_prefix: string
          p_year: number
        }
        Returns: string
      }
    }
    Enums: {
      user_role:
        | "SUPER_ADMIN"
        | "MANAGER"
        | "BUDGET_OFFICER"
        | "ACCOUNTING"
        | "PURCHASER"
        | "MAINTENANCE"
        | "FRONT_DESK"
        | "STAFF"
        | "STOREKEEPER"
      account_status: "ACTIVE" | "INACTIVE" | "PASSWORD_RESET_REQUIRED"
      jo_priority: "NORMAL" | "URGENT" | "EMERGENCY"
      jo_status:
        | "PENDING_ASSESSMENT"
        | "IN_PROGRESS"
        | "AWAITING_MRS_APPROVAL"
        | "MRS_REJECTED"
        | "COMPLETED"
        | "MATERIALS_RECEIVED"
        | "CLOSED"
        | "REOPENED_UNRESOLVED"
        | "CRITICAL_REOPEN_ESCALATED"
        | "CANCELLED"
      mrs_type: "STANDALONE" | "JOB_ORDER"
      mrs_status:
        | "PENDING_MANAGER"
        | "MANAGER_REJECTED"
        | "IN_CANVASSING"
        | "PENDING_OWNER"
        | "OWNER_REJECTED"
        | "APPROVED_READY_TO_ORDER"
        | "IN_TRANSIT"
        | "TRANSMITTAL_IN_PROGRESS"
        | "READY_FOR_PURCHASE"
        | "PURCHASING"
        | "FULFILLED"
        | "PARTIALLY_FULFILLED_BUDGET_EXHAUSTED"
        | "DISPUTED"
        | "EMERGENCY_FAST_TRACK"
        | "ISSUED_FROM_STOCK"
        | "VOIDED"
        | "CLOSED"
      transmittal_type:
        | "INITIAL_DISBURSEMENT"
        | "SPARE_CHANGE_RETURN"
        | "SUPPLEMENTAL_DISBURSEMENT"
        | "EMERGENCY_REIMBURSEMENT"
        | "DIRECT_ONLINE_DISBURSEMENT"
        | "FD_REVOLVING_DISBURSEMENT"
        | "FD_REVOLVING_REPLENISHMENT"
        | "ONLINE_COD_ADVANCE"
        | "BATCH_DISBURSEMENT"
      transmittal_status: "PENDING" | "SENT" | "RECEIVED" | "CANCELLED"
      item_delivery_status:
        | "PENDING"
        | "IN_TRANSIT"
        | "DELIVERED"
        | "BACKORDERED"
        | "BUDGET_EXHAUSTED"
        | "UNAVAILABLE"
      pms_interval:
        | "DAILY"
        | "WEEKLY"
        | "MONTHLY"
        | "CUSTOM_MONTHS"
        | "YEARLY"
      asset_category:
        | "HVAC"
        | "ELECTRICAL"
        | "PLUMBING"
        | "STRUCTURAL"
        | "KITCHEN_EQUIPMENT"
        | "GENERAL"
      photo_context:
        | "JO_SITE_PHOTO"
        | "JO_REOPEN_PHOTO"
        | "MRS_ITEM_REFERENCE"
        | "MRS_ONLINE_SCREENSHOT"
        | "PURCHASE_RECEIPT"
        | "DELIVERY_PROOF"
        | "AIRCON_SERVICE_PHOTO"
        | "FD_COD_RECEIPT"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
