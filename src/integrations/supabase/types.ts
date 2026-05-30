export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      column_permissions: {
        Row: {
          access: string
          column_key: string
          created_at: string
          id: string
          menu_code: string
          role_id: string
          updated_at: string
        }
        Insert: {
          access?: string
          column_key: string
          created_at?: string
          id?: string
          menu_code: string
          role_id: string
          updated_at?: string
        }
        Update: {
          access?: string
          column_key?: string
          created_at?: string
          id?: string
          menu_code?: string
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "column_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          country: string | null
          created_at: string
          customer_code: string
          district: string | null
          email: string | null
          gender: string | null
          id: string
          name: string | null
          phone: string | null
          state: string | null
          street: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          customer_code: string
          district?: string | null
          email?: string | null
          gender?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          customer_code?: string
          district?: string | null
          email?: string | null
          gender?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      data_master: {
        Row: {
          auto_create_lot: string | null
          available_in_self_order: string | null
          barcode: string | null
          brand: string | null
          buyer_code: string | null
          buying_status: string | null
          class: string | null
          class_code: string | null
          create_purchase_order_pos: string | null
          created_at: string
          dc_min_stock: number | null
          default_location: string | null
          department: string | null
          department_code: string | null
          depth: number | null
          discontinue_action_code: string | null
          discontinue_action_name: string | null
          division: string | null
          division_code: string | null
          division_group: string | null
          division_group_code: string | null
          excise_tax: number | null
          gm_buyer_code: string | null
          header_buyer_code: string | null
          height: number | null
          high_value: string | null
          house_brand: string | null
          hs_code: string | null
          id: string
          import_tax: number | null
          inactive_action_code: string | null
          inactive_action_name: string | null
          item_classify: string | null
          item_origin: string | null
          item_status: string | null
          item_type: string | null
          jmart_price: number | null
          lao_label: string | null
          list_price: number | null
          main_barcode: string | null
          max_display: number | null
          mfg_expire_status: string | null
          min_display: number | null
          min_order_pcs: number | null
          one_retail_status: string | null
          order_condition: string | null
          pack_product: string | null
          packing_size: string | null
          packing_size_qty: number | null
          po_group: string | null
          product_bu: string | null
          product_name_cn: string | null
          product_name_en: string | null
          product_name_kr: string | null
          product_name_la: string | null
          product_name_th: string | null
          product_owner: string | null
          product_shelf_life: string | null
          product_type: string | null
          purchase: string | null
          register_date: string | null
          register_form_status: string | null
          replenishment_type: string | null
          returnable_flag: string | null
          rtv_condition: string | null
          sale_ranging: string | null
          sales: string | null
          sku_code: string | null
          small_unit_flag: string | null
          standard_price: number | null
          stock_unit_flag: string | null
          store_selection: string | null
          sub_class: string | null
          sub_class_code: string | null
          sub_department: string | null
          sub_department_code: string | null
          tax_rate: number | null
          track_inventory: string | null
          tracking: string | null
          unit_of_measure: string | null
          unit_picking_mart: string | null
          unit_picking_super: string | null
          updated_at: string
          use_serial: string | null
          valuation_by_lot: string | null
          vat_flag: string | null
          vdi_code: string | null
          vendor_code: string | null
          vendor_current_status: string | null
          vendor_display_name: string | null
          weight: number | null
          width: number | null
        }
        Insert: {
          auto_create_lot?: string | null
          available_in_self_order?: string | null
          barcode?: string | null
          brand?: string | null
          buyer_code?: string | null
          buying_status?: string | null
          class?: string | null
          class_code?: string | null
          create_purchase_order_pos?: string | null
          created_at?: string
          dc_min_stock?: number | null
          default_location?: string | null
          department?: string | null
          department_code?: string | null
          depth?: number | null
          discontinue_action_code?: string | null
          discontinue_action_name?: string | null
          division?: string | null
          division_code?: string | null
          division_group?: string | null
          division_group_code?: string | null
          excise_tax?: number | null
          gm_buyer_code?: string | null
          header_buyer_code?: string | null
          height?: number | null
          high_value?: string | null
          house_brand?: string | null
          hs_code?: string | null
          id?: string
          import_tax?: number | null
          inactive_action_code?: string | null
          inactive_action_name?: string | null
          item_classify?: string | null
          item_origin?: string | null
          item_status?: string | null
          item_type?: string | null
          jmart_price?: number | null
          lao_label?: string | null
          list_price?: number | null
          main_barcode?: string | null
          max_display?: number | null
          mfg_expire_status?: string | null
          min_display?: number | null
          min_order_pcs?: number | null
          one_retail_status?: string | null
          order_condition?: string | null
          pack_product?: string | null
          packing_size?: string | null
          packing_size_qty?: number | null
          po_group?: string | null
          product_bu?: string | null
          product_name_cn?: string | null
          product_name_en?: string | null
          product_name_kr?: string | null
          product_name_la?: string | null
          product_name_th?: string | null
          product_owner?: string | null
          product_shelf_life?: string | null
          product_type?: string | null
          purchase?: string | null
          register_date?: string | null
          register_form_status?: string | null
          replenishment_type?: string | null
          returnable_flag?: string | null
          rtv_condition?: string | null
          sale_ranging?: string | null
          sales?: string | null
          sku_code?: string | null
          small_unit_flag?: string | null
          standard_price?: number | null
          stock_unit_flag?: string | null
          store_selection?: string | null
          sub_class?: string | null
          sub_class_code?: string | null
          sub_department?: string | null
          sub_department_code?: string | null
          tax_rate?: number | null
          track_inventory?: string | null
          tracking?: string | null
          unit_of_measure?: string | null
          unit_picking_mart?: string | null
          unit_picking_super?: string | null
          updated_at?: string
          use_serial?: string | null
          valuation_by_lot?: string | null
          vat_flag?: string | null
          vdi_code?: string | null
          vendor_code?: string | null
          vendor_current_status?: string | null
          vendor_display_name?: string | null
          weight?: number | null
          width?: number | null
        }
        Update: {
          auto_create_lot?: string | null
          available_in_self_order?: string | null
          barcode?: string | null
          brand?: string | null
          buyer_code?: string | null
          buying_status?: string | null
          class?: string | null
          class_code?: string | null
          create_purchase_order_pos?: string | null
          created_at?: string
          dc_min_stock?: number | null
          default_location?: string | null
          department?: string | null
          department_code?: string | null
          depth?: number | null
          discontinue_action_code?: string | null
          discontinue_action_name?: string | null
          division?: string | null
          division_code?: string | null
          division_group?: string | null
          division_group_code?: string | null
          excise_tax?: number | null
          gm_buyer_code?: string | null
          header_buyer_code?: string | null
          height?: number | null
          high_value?: string | null
          house_brand?: string | null
          hs_code?: string | null
          id?: string
          import_tax?: number | null
          inactive_action_code?: string | null
          inactive_action_name?: string | null
          item_classify?: string | null
          item_origin?: string | null
          item_status?: string | null
          item_type?: string | null
          jmart_price?: number | null
          lao_label?: string | null
          list_price?: number | null
          main_barcode?: string | null
          max_display?: number | null
          mfg_expire_status?: string | null
          min_display?: number | null
          min_order_pcs?: number | null
          one_retail_status?: string | null
          order_condition?: string | null
          pack_product?: string | null
          packing_size?: string | null
          packing_size_qty?: number | null
          po_group?: string | null
          product_bu?: string | null
          product_name_cn?: string | null
          product_name_en?: string | null
          product_name_kr?: string | null
          product_name_la?: string | null
          product_name_th?: string | null
          product_owner?: string | null
          product_shelf_life?: string | null
          product_type?: string | null
          purchase?: string | null
          register_date?: string | null
          register_form_status?: string | null
          replenishment_type?: string | null
          returnable_flag?: string | null
          rtv_condition?: string | null
          sale_ranging?: string | null
          sales?: string | null
          sku_code?: string | null
          small_unit_flag?: string | null
          standard_price?: number | null
          stock_unit_flag?: string | null
          store_selection?: string | null
          sub_class?: string | null
          sub_class_code?: string | null
          sub_department?: string | null
          sub_department_code?: string | null
          tax_rate?: number | null
          track_inventory?: string | null
          tracking?: string | null
          unit_of_measure?: string | null
          unit_picking_mart?: string | null
          unit_picking_super?: string | null
          updated_at?: string
          use_serial?: string | null
          valuation_by_lot?: string | null
          vat_flag?: string | null
          vdi_code?: string | null
          vendor_code?: string | null
          vendor_current_status?: string | null
          vendor_display_name?: string | null
          weight?: number | null
          width?: number | null
        }
        Relationships: []
      }
      document_locations: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_movements: {
        Row: {
          action: string
          attachment_uploaded_by: string | null
          attachment_url: string | null
          codes: Json
          created_at: string
          depositor_name: string | null
          id: string
          location_name: string
          notes: string | null
          receiver_name: string | null
          shipment_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          attachment_uploaded_by?: string | null
          attachment_url?: string | null
          codes?: Json
          created_at?: string
          depositor_name?: string | null
          id?: string
          location_name: string
          notes?: string | null
          receiver_name?: string | null
          shipment_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          attachment_uploaded_by?: string | null
          attachment_url?: string | null
          codes?: Json
          created_at?: string
          depositor_name?: string | null
          id?: string
          location_name?: string
          notes?: string | null
          receiver_name?: string | null
          shipment_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_movements_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "document_shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      document_shipments: {
        Row: {
          compared_at: string | null
          created_at: string
          depositor_name: string | null
          destination_codes: Json
          destination_location: string | null
          destination_scanned_at: string | null
          doc_name: string
          id: string
          origin_codes: Json
          origin_location: string | null
          origin_scanned_at: string | null
          receiver_name: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          compared_at?: string | null
          created_at?: string
          depositor_name?: string | null
          destination_codes?: Json
          destination_location?: string | null
          destination_scanned_at?: string | null
          doc_name: string
          id?: string
          origin_codes?: Json
          origin_location?: string | null
          origin_scanned_at?: string | null
          receiver_name?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          compared_at?: string | null
          created_at?: string
          depositor_name?: string | null
          destination_codes?: Json
          destination_location?: string | null
          destination_scanned_at?: string | null
          doc_name?: string
          id?: string
          origin_codes?: Json
          origin_location?: string | null
          origin_scanned_at?: string | null
          receiver_name?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      export_templates: {
        Row: {
          columns: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          target_menu: string
          updated_at: string
        }
        Insert: {
          columns?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          target_menu: string
          updated_at?: string
        }
        Update: {
          columns?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          target_menu?: string
          updated_at?: string
        }
        Relationships: []
      }
      filter_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          rules: Json
          target_table: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          rules?: Json
          target_table: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          rules?: Json
          target_table?: string
          updated_at?: string
        }
        Relationships: []
      }
      help_sections: {
        Row: {
          data: Json
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          data?: Json
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          data?: Json
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      job_assignments: {
        Row: {
          assignee_name: string
          assignee_phone: string | null
          attachment_name: string | null
          attachment_type: string | null
          attachment_url: string | null
          completed_at: string | null
          content: string
          created_at: string
          due_date: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assignee_name: string
          assignee_phone?: string | null
          attachment_name?: string | null
          attachment_type?: string | null
          attachment_url?: string | null
          completed_at?: string | null
          content: string
          created_at?: string
          due_date: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assignee_name?: string
          assignee_phone?: string | null
          attachment_name?: string | null
          attachment_type?: string | null
          attachment_url?: string | null
          completed_at?: string | null
          content?: string
          created_at?: string
          due_date?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      list_po: {
        Row: {
          created_at: string
          currency_name: string | null
          delivery_to1: string | null
          delivery_to2: string | null
          document: string | null
          id: string
          order_reference: string
          partner: string | null
          source: string | null
          status: string | null
          total: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_name?: string | null
          delivery_to1?: string | null
          delivery_to2?: string | null
          document?: string | null
          id?: string
          order_reference: string
          partner?: string | null
          source?: string | null
          status?: string | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_name?: string | null
          delivery_to1?: string | null
          delivery_to2?: string | null
          document?: string | null
          id?: string
          order_reference?: string
          partner?: string | null
          source?: string | null
          status?: string | null
          total?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      menus: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          menu_code: string
          menu_name: string
          menu_type: string
          parent_id: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          menu_code: string
          menu_name: string
          menu_type?: string
          parent_id?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          menu_code?: string
          menu_name?: string
          menu_type?: string
          parent_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menus_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
        ]
      }
      minmax: {
        Row: {
          created_at: string
          id: string
          item_id: string | null
          max_val: number | null
          min_val: number | null
          store_name: string | null
          type_store: string | null
          unit_pick: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id?: string | null
          max_val?: number | null
          min_val?: number | null
          store_name?: string | null
          type_store?: string | null
          unit_pick?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string | null
          max_val?: number | null
          min_val?: number | null
          store_name?: string | null
          type_store?: string | null
          unit_pick?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      minmax_cal_documents: {
        Row: {
          created_at: string
          data: Json
          doc_name: string
          id: string
          item_count: number
          n_factor: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          doc_name: string
          id?: string
          item_count?: number
          n_factor?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          doc_name?: string
          id?: string
          item_count?: number
          n_factor?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      on_order: {
        Row: {
          created_at: string
          id: string
          id18: string | null
          item_id: string | null
          last_po_date: string | null
          po_number: string | null
          po_qty: number | null
          sku_code: string | null
          sku_name: string | null
          store_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          id18?: string | null
          item_id?: string | null
          last_po_date?: string | null
          po_number?: string | null
          po_qty?: number | null
          sku_code?: string | null
          sku_name?: string | null
          store_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          id18?: string | null
          item_id?: string | null
          last_po_date?: string | null
          po_number?: string | null
          po_qty?: number | null
          sku_code?: string | null
          sku_name?: string | null
          store_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      on_order_dc: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_name_en: string | null
          product_name_la: string | null
          qty: number
          sku_code: string
          store_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_name_en?: string | null
          product_name_la?: string | null
          qty?: number
          sku_code: string
          store_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_name_en?: string | null
          product_name_la?: string | null
          qty?: number
          sku_code?: string
          store_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_overdue: {
        Row: {
          amount_overdue: number
          attachment_name: string | null
          attachment_url: string | null
          created_at: string
          document_name: string | null
          document_url: string | null
          drive_link: string | null
          id: string
          paid_at: string | null
          paid_total: number
          reason: string | null
          status: string
          supplier_currency: string | null
          updated_at: string
          user_id: string
          vat_percent: number | null
          vendor_code: string
          vendor_name: string | null
        }
        Insert: {
          amount_overdue?: number
          attachment_name?: string | null
          attachment_url?: string | null
          created_at?: string
          document_name?: string | null
          document_url?: string | null
          drive_link?: string | null
          id?: string
          paid_at?: string | null
          paid_total?: number
          reason?: string | null
          status?: string
          supplier_currency?: string | null
          updated_at?: string
          user_id: string
          vat_percent?: number | null
          vendor_code: string
          vendor_name?: string | null
        }
        Update: {
          amount_overdue?: number
          attachment_name?: string | null
          attachment_url?: string | null
          created_at?: string
          document_name?: string | null
          document_url?: string | null
          drive_link?: string | null
          id?: string
          paid_at?: string | null
          paid_total?: number
          reason?: string | null
          status?: string
          supplier_currency?: string | null
          updated_at?: string
          user_id?: string
          vat_percent?: number | null
          vendor_code?: string
          vendor_name?: string | null
        }
        Relationships: []
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          permission_name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          permission_name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          permission_name?: string
        }
        Relationships: []
      }
      po_cost: {
        Row: {
          created_at: string
          goodcode: string | null
          id: string
          item_id: string | null
          moq: number | null
          po_cost: number | null
          po_cost_unit: number | null
          product_name: string | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          created_at?: string
          goodcode?: string | null
          id?: string
          item_id?: string | null
          moq?: number | null
          po_cost?: number | null
          po_cost_unit?: number | null
          product_name?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          created_at?: string
          goodcode?: string | null
          id?: string
          item_id?: string | null
          moq?: number | null
          po_cost?: number | null
          po_cost_unit?: number | null
          product_name?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: []
      }
      po_cost_log: {
        Row: {
          activity: string
          changes: Json | null
          created_at: string
          goodcode: string | null
          id: string
          item_id: string | null
          moq: number | null
          po_cost: number | null
          po_cost_id: string | null
          po_cost_unit: number | null
          product_name: string | null
          user_email: string | null
          user_id: string | null
          vendor: string | null
        }
        Insert: {
          activity: string
          changes?: Json | null
          created_at?: string
          goodcode?: string | null
          id?: string
          item_id?: string | null
          moq?: number | null
          po_cost?: number | null
          po_cost_id?: string | null
          po_cost_unit?: number | null
          product_name?: string | null
          user_email?: string | null
          user_id?: string | null
          vendor?: string | null
        }
        Update: {
          activity?: string
          changes?: Json | null
          created_at?: string
          goodcode?: string | null
          id?: string
          item_id?: string | null
          moq?: number | null
          po_cost?: number | null
          po_cost_id?: string | null
          po_cost_unit?: number | null
          product_name?: string | null
          user_email?: string | null
          user_id?: string | null
          vendor?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          department: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          spc_name: string | null
          updated_at: string
          user_id: string
          vendor_code: string | null
        }
        Insert: {
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          spc_name?: string | null
          updated_at?: string
          user_id: string
          vendor_code?: string | null
        }
        Update: {
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          spc_name?: string | null
          updated_at?: string
          user_id?: string
          vendor_code?: string | null
        }
        Relationships: []
      }
      range_store: {
        Row: {
          apply_yn: string
          created_at: string
          id: string
          min_display: number | null
          sku_code: string
          store_name: string
          unit_picking_mart: number | null
          unit_picking_super: number | null
          updated_at: string
        }
        Insert: {
          apply_yn?: string
          created_at?: string
          id?: string
          min_display?: number | null
          sku_code: string
          store_name: string
          unit_picking_mart?: number | null
          unit_picking_super?: number | null
          updated_at?: string
        }
        Update: {
          apply_yn?: string
          created_at?: string
          id?: string
          min_display?: number | null
          sku_code?: string
          store_name?: string
          unit_picking_mart?: number | null
          unit_picking_super?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      range_store_view: {
        Row: {
          avg_jmart: number | null
          avg_kokkok: number | null
          avg_kokkok_fc: number | null
          avg_per_store: Json | null
          avg_udee: number | null
          barcode_box: string | null
          barcode_pack: string | null
          box_qty: number | null
          buyer_code: string | null
          buying_status: string | null
          class: string | null
          department: string | null
          division: string | null
          division_group: string | null
          gm_buyer_code: string | null
          item_status: string | null
          item_type: string | null
          list_price: number | null
          main_barcode: string | null
          pack_qty: number | null
          packing_size_qty: number | null
          product_bu: string | null
          product_name_en: string | null
          product_name_la: string | null
          product_owner: string | null
          range_data: Json | null
          rank_sale: string | null
          sku_code: string
          standard_price: number | null
          sub_department: string | null
          synced_at: string
          unit_of_measure: string | null
        }
        Insert: {
          avg_jmart?: number | null
          avg_kokkok?: number | null
          avg_kokkok_fc?: number | null
          avg_per_store?: Json | null
          avg_udee?: number | null
          barcode_box?: string | null
          barcode_pack?: string | null
          box_qty?: number | null
          buyer_code?: string | null
          buying_status?: string | null
          class?: string | null
          department?: string | null
          division?: string | null
          division_group?: string | null
          gm_buyer_code?: string | null
          item_status?: string | null
          item_type?: string | null
          list_price?: number | null
          main_barcode?: string | null
          pack_qty?: number | null
          packing_size_qty?: number | null
          product_bu?: string | null
          product_name_en?: string | null
          product_name_la?: string | null
          product_owner?: string | null
          range_data?: Json | null
          rank_sale?: string | null
          sku_code: string
          standard_price?: number | null
          sub_department?: string | null
          synced_at?: string
          unit_of_measure?: string | null
        }
        Update: {
          avg_jmart?: number | null
          avg_kokkok?: number | null
          avg_kokkok_fc?: number | null
          avg_per_store?: Json | null
          avg_udee?: number | null
          barcode_box?: string | null
          barcode_pack?: string | null
          box_qty?: number | null
          buyer_code?: string | null
          buying_status?: string | null
          class?: string | null
          department?: string | null
          division?: string | null
          division_group?: string | null
          gm_buyer_code?: string | null
          item_status?: string | null
          item_type?: string | null
          list_price?: number | null
          main_barcode?: string | null
          pack_qty?: number | null
          packing_size_qty?: number | null
          product_bu?: string | null
          product_name_en?: string | null
          product_name_la?: string | null
          product_owner?: string | null
          range_data?: Json | null
          rank_sale?: string | null
          sku_code?: string
          standard_price?: number | null
          sub_department?: string | null
          synced_at?: string
          unit_of_measure?: string | null
        }
        Relationships: []
      }
      rank_sales: {
        Row: {
          created_at: string
          final_rank: string | null
          id: string
          item_id: string | null
          product_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          final_rank?: string | null
          id?: string
          item_id?: string | null
          product_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          final_rank?: string | null
          id?: string
          item_id?: string | null
          product_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      role_division_access: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_import: boolean
          can_view: boolean
          created_at: string
          division: string
          id: string
          role_id: string
          updated_at: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_import?: boolean
          can_view?: boolean
          created_at?: string
          division: string
          id?: string
          role_id: string
          updated_at?: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_import?: boolean
          can_view?: boolean
          created_at?: string
          division?: string
          id?: string
          role_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_menu_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_import: boolean
          can_view: boolean
          id: string
          menu_id: string
          role_id: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_import?: boolean
          can_view?: boolean
          id?: string
          menu_id: string
          role_id: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_import?: boolean
          can_view?: boolean
          id?: string
          menu_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_menu_permissions_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_menu_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          role_name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          role_name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          role_name?: string
        }
        Relationships: []
      }
      sales_by_week: {
        Row: {
          avg_day: number | null
          created_at: string
          id: string
          id18: string | null
          item_id: string | null
          old_id: string | null
          store_name: string | null
          type_store: string | null
          updated_at: string
        }
        Insert: {
          avg_day?: number | null
          created_at?: string
          id?: string
          id18?: string | null
          item_id?: string | null
          old_id?: string | null
          store_name?: string | null
          type_store?: string | null
          updated_at?: string
        }
        Update: {
          avg_day?: number | null
          created_at?: string
          id?: string
          id18?: string | null
          item_id?: string | null
          old_id?: string | null
          store_name?: string | null
          type_store?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sar_snapshots: {
        Row: {
          created_at: string
          data: Json
          doc_name: string
          id: string
          item_count: number
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          doc_name: string
          id?: string
          item_count?: number
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          doc_name?: string
          id?: string
          item_count?: number
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_po_documents: {
        Row: {
          created_at: string
          date_key: string
          id: string
          item_count: number
          po_data: Json
          source: string
          spc_name: string
          updated_at: string
          user_id: string
          vendor_code: string
          vendor_display: string | null
        }
        Insert: {
          created_at?: string
          date_key: string
          id?: string
          item_count?: number
          po_data?: Json
          source?: string
          spc_name: string
          updated_at?: string
          user_id: string
          vendor_code: string
          vendor_display?: string | null
        }
        Update: {
          created_at?: string
          date_key?: string
          id?: string
          item_count?: number
          po_data?: Json
          source?: string
          spc_name?: string
          updated_at?: string
          user_id?: string
          vendor_code?: string
          vendor_display?: string | null
        }
        Relationships: []
      }
      sku_no_order: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_name_en: string | null
          product_name_la: string | null
          sku_code: string
          store_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_name_en?: string | null
          product_name_la?: string | null
          sku_code: string
          store_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_name_en?: string | null
          product_name_la?: string | null
          sku_code?: string
          store_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      srr_d2s_snapshots: {
        Row: {
          created_at: string
          data: Json
          date_key: string
          edit_count: number
          edited_columns: string[] | null
          id: string
          item_count: number
          source: string
          spc_name: string
          store_name: string
          suggest_count: number
          type_store: string | null
          updated_at: string
          user_id: string
          vendor_code: string
          vendor_display: string | null
        }
        Insert: {
          created_at?: string
          data?: Json
          date_key: string
          edit_count?: number
          edited_columns?: string[] | null
          id?: string
          item_count?: number
          source?: string
          spc_name: string
          store_name: string
          suggest_count?: number
          type_store?: string | null
          updated_at?: string
          user_id: string
          vendor_code: string
          vendor_display?: string | null
        }
        Update: {
          created_at?: string
          data?: Json
          date_key?: string
          edit_count?: number
          edited_columns?: string[] | null
          id?: string
          item_count?: number
          source?: string
          spc_name?: string
          store_name?: string
          suggest_count?: number
          type_store?: string | null
          updated_at?: string
          user_id?: string
          vendor_code?: string
          vendor_display?: string | null
        }
        Relationships: []
      }
      srr_public_column_views: {
        Row: {
          columns: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
          scope: string
          updated_at: string
        }
        Insert: {
          columns?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          scope: string
          updated_at?: string
        }
        Update: {
          columns?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      srr_snapshots: {
        Row: {
          created_at: string
          data: Json
          date_key: string
          edit_count: number
          edited_columns: string[] | null
          id: string
          item_count: number
          source: string
          spc_name: string
          suggest_count: number
          updated_at: string
          user_id: string
          vendor_code: string
          vendor_display: string | null
        }
        Insert: {
          created_at?: string
          data?: Json
          date_key: string
          edit_count?: number
          edited_columns?: string[] | null
          id?: string
          item_count?: number
          source?: string
          spc_name: string
          suggest_count?: number
          updated_at?: string
          user_id: string
          vendor_code: string
          vendor_display?: string | null
        }
        Update: {
          created_at?: string
          data?: Json
          date_key?: string
          edit_count?: number
          edited_columns?: string[] | null
          id?: string
          item_count?: number
          source?: string
          spc_name?: string
          suggest_count?: number
          updated_at?: string
          user_id?: string
          vendor_code?: string
          vendor_display?: string | null
        }
        Relationships: []
      }
      stock: {
        Row: {
          barcode: string | null
          company: string | null
          created_at: string
          id: string
          inventoried_quantity: number | null
          item_id: string | null
          location: string | null
          on_hand: number | null
          package: string | null
          product: string | null
          quantity: number | null
          reserved_quantity: number | null
          type_store: string | null
          unit_of_measure: string | null
          updated_at: string
          values_amount: number | null
        }
        Insert: {
          barcode?: string | null
          company?: string | null
          created_at?: string
          id?: string
          inventoried_quantity?: number | null
          item_id?: string | null
          location?: string | null
          on_hand?: number | null
          package?: string | null
          product?: string | null
          quantity?: number | null
          reserved_quantity?: number | null
          type_store?: string | null
          unit_of_measure?: string | null
          updated_at?: string
          values_amount?: number | null
        }
        Update: {
          barcode?: string | null
          company?: string | null
          created_at?: string
          id?: string
          inventoried_quantity?: number | null
          item_id?: string | null
          location?: string | null
          on_hand?: number | null
          package?: string | null
          product?: string | null
          quantity?: number | null
          reserved_quantity?: number | null
          type_store?: string | null
          unit_of_measure?: string | null
          updated_at?: string
          values_amount?: number | null
        }
        Relationships: []
      }
      store_priority: {
        Row: {
          created_at: string
          id: string
          priority: number | null
          store_name: string
          type_store: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          priority?: number | null
          store_name: string
          type_store?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          priority?: number | null
          store_name?: string
          type_store?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      store_type: {
        Row: {
          code: string | null
          created_at: string
          id: string
          ship_to: string | null
          size_store: string | null
          store_name: string | null
          type_doc: string | null
          type_store: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          ship_to?: string | null
          size_store?: string | null
          store_name?: string | null
          type_doc?: string | null
          type_store?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          ship_to?: string | null
          size_store?: string | null
          store_name?: string | null
          type_doc?: string | null
          type_store?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tab_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_import: boolean
          can_view: boolean
          created_at: string
          id: string
          menu_code: string
          role_id: string
          tab_key: string
          updated_at: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_import?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          menu_code: string
          role_id: string
          tab_key: string
          updated_at?: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_import?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          menu_code?: string
          role_id?: string
          tab_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_master: {
        Row: {
          created_at: string
          delivery_day: string | null
          id: string
          leadtime: number | null
          order_cycle: number | null
          order_day: string | null
          purchase_agreement_vat: string | null
          replenishment_type: string | null
          spc_name: string | null
          supp_current_status: string | null
          supplier_currency: string | null
          trade_term: string | null
          updated_at: string
          vat_percent: number | null
          vendor_code: string | null
          vendor_name_en: string | null
          vendor_name_la: string | null
          vendor_origin: string | null
          vendor_payment_terms: string | null
          vendor_type: string | null
        }
        Insert: {
          created_at?: string
          delivery_day?: string | null
          id?: string
          leadtime?: number | null
          order_cycle?: number | null
          order_day?: string | null
          purchase_agreement_vat?: string | null
          replenishment_type?: string | null
          spc_name?: string | null
          supp_current_status?: string | null
          supplier_currency?: string | null
          trade_term?: string | null
          updated_at?: string
          vat_percent?: number | null
          vendor_code?: string | null
          vendor_name_en?: string | null
          vendor_name_la?: string | null
          vendor_origin?: string | null
          vendor_payment_terms?: string | null
          vendor_type?: string | null
        }
        Update: {
          created_at?: string
          delivery_day?: string | null
          id?: string
          leadtime?: number | null
          order_cycle?: number | null
          order_day?: string | null
          purchase_agreement_vat?: string | null
          replenishment_type?: string | null
          spc_name?: string | null
          supp_current_status?: string | null
          supplier_currency?: string | null
          trade_term?: string | null
          updated_at?: string
          vat_percent?: number | null
          vendor_code?: string | null
          vendor_name_en?: string | null
          vendor_name_la?: string | null
          vendor_origin?: string | null
          vendor_payment_terms?: string | null
          vendor_type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      minmax_flat: {
        Row: {
          max_val: number | null
          min_val: number | null
          sku_code: string | null
          store_name: string | null
        }
        Relationships: []
      }
      mv_range_store: {
        Row: {
          avg_jmart: number | null
          avg_kokkok: number | null
          avg_kokkok_fc: number | null
          avg_per_store: Json | null
          avg_udee: number | null
          barcode_box: string | null
          barcode_pack: string | null
          box_qty: number | null
          buyer_code: string | null
          buying_status: string | null
          class: string | null
          department: string | null
          division: string | null
          division_group: string | null
          gm_buyer_code: string | null
          item_status: string | null
          item_type: string | null
          list_price: number | null
          main_barcode: string | null
          pack_qty: number | null
          packing_size_qty: number | null
          product_bu: string | null
          product_name_en: string | null
          product_name_la: string | null
          product_owner: string | null
          range_data: Json | null
          rank_sale: string | null
          sku_code: string | null
          standard_price: number | null
          sub_department: string | null
          unit_of_measure: string | null
        }
        Relationships: []
      }
      po_cost_enriched: {
        Row: {
          buyer_code: string | null
          class: string | null
          created_at: string | null
          department: string | null
          division: string | null
          division_group: string | null
          gm_buyer_code: string | null
          goodcode: string | null
          header_buyer_code: string | null
          id: string | null
          item_id: string | null
          jmart_price: number | null
          list_price: number | null
          main_barcode_pack: string | null
          main_barcode_unit: string | null
          moq: number | null
          po_cost: number | null
          po_cost_unit: number | null
          po_product_name: string | null
          product_name_la: string | null
          sub_class: string | null
          sub_department: string | null
          supplier_currency: string | null
          updated_at: string | null
          vendor_code: string | null
          vendor_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calc_minmax_rows: {
        Args: { p_n_factor?: number }
        Returns: {
          avg_sale: number
          is_default_min: boolean
          main_barcode: string
          max_cal: number
          min_cal: number
          product_name_en: string
          product_name_la: string
          rank_factor: number
          rank_sale: string
          size_store: string
          sku_code: string
          store_name: string
          type_store: string
          unit_of_measure: string
          unit_pick: number
        }[]
      }
      cleanup_old_d2s_snapshots: { Args: never; Returns: number }
      cleanup_old_snapshots: { Args: never; Returns: number }
      clear_range_min: {
        Args: { p_skus?: string[]; p_stores?: string[] }
        Returns: number
      }
      clear_range_store:
        | { Args: { p_skus?: string[] }; Returns: number }
        | { Args: { p_skus?: string[]; p_stores?: string[] }; Returns: number }
      delete_minmax_by_filter: {
        Args: {
          p_buying_statuses?: string[]
          p_classes?: string[]
          p_departments?: string[]
          p_divisions?: string[]
          p_item_types?: string[]
          p_stores?: string[]
          p_sub_departments?: string[]
          p_type_stores?: string[]
        }
        Returns: number
      }
      delete_minmax_by_stores: {
        Args: { p_store_names: string[] }
        Returns: number
      }
      get_assignable_users: {
        Args: never
        Returns: {
          full_name: string
          phone: string
          user_id: string
        }[]
      }
      get_latest_minmax_doc: {
        Args: never
        Returns: {
          created_at: string
          doc_id: string
          doc_name: string
          max_val: number
          min_val: number
          sku_code: string
          store_name: string
          type_store: string
          unit_pick: number
        }[]
      }
      get_latest_minmax_flat: {
        Args: never
        Returns: {
          max_val: number
          min_val: number
          sku_code: string
          store_name: string
          type_store: string
        }[]
      }
      get_latest_minmax_for_skus: {
        Args: { p_skus: string[] }
        Returns: {
          max_val: number
          min_val: number
          sku_code: string
          store_name: string
          type_store: string
        }[]
      }
      get_minmax_calc_all: {
        Args: {
          p_barcodes?: string[]
          p_buying_statuses?: string[]
          p_classes?: string[]
          p_departments?: string[]
          p_divisions?: string[]
          p_item_types?: string[]
          p_n_factor?: number
          p_sku_codes?: string[]
          p_store_names?: string[]
          p_sub_departments?: string[]
          p_type_stores?: string[]
        }
        Returns: {
          avg_sale: number
          box_qty: number
          buying_status: string
          class: string
          department: string
          division: string
          is_default_min: boolean
          item_type: string
          main_barcode: string
          max_cal: number
          min_cal: number
          pack_qty: number
          product_name_en: string
          product_name_la: string
          rank_factor: number
          rank_sale: string
          size_store: string
          sku_code: string
          store_name: string
          sub_department: string
          type_store: string
          unit_of_measure: string
          unit_pick: number
        }[]
      }
      get_minmax_filter_options: {
        Args: never
        Returns: {
          buying_statuses: string[]
          classes: string[]
          departments: string[]
          divisions: string[]
          item_types: string[]
          stores: Json
          sub_departments: string[]
        }[]
      }
      get_minmax_master: {
        Args: never
        Returns: {
          main_barcode: string
          product_name_en: string
          product_name_la: string
          rank_sale: string
          sku_code: string
          unit_of_measure: string
        }[]
      }
      get_minmax_range_store: {
        Args: never
        Returns: {
          size_store: string
          sku_code: string
          store_name: string
          type_store: string
          unit_picking_mart: number
          unit_picking_super: number
        }[]
      }
      get_minmax_report_grouped: {
        Args: {
          p_buying_statuses?: string[]
          p_classes?: string[]
          p_departments?: string[]
          p_divisions?: string[]
          p_item_types?: string[]
          p_stores?: string[]
          p_sub_departments?: string[]
          p_type_stores?: string[]
        }
        Returns: {
          department: string
          division: string
          sku_count: number
          store_name: string
          sum_max: number
          sum_min: number
          type_store: string
        }[]
      }
      get_minmax_report_summary: {
        Args: never
        Returns: {
          sku_count: number
          store_name: string
          sum_max: number
          sum_min: number
          type_store: string
        }[]
      }
      get_minmax_sales_per_store: {
        Args: never
        Returns: {
          avg_sale: number
          sku_code: string
          store_name: string
        }[]
      }
      get_minmax_view_by_stores: {
        Args: {
          p_barcodes?: string[]
          p_buying_statuses?: string[]
          p_classes?: string[]
          p_departments?: string[]
          p_divisions?: string[]
          p_item_types?: string[]
          p_skus?: string[]
          p_stores?: string[]
          p_sub_departments?: string[]
          p_type_stores?: string[]
        }
        Returns: {
          box_qty: number
          buying_status: string
          class: string
          department: string
          division: string
          item_type: string
          main_barcode: string
          max_val: number
          min_val: number
          pack_qty: number
          product_name_en: string
          product_name_la: string
          sku_code: string
          store_name: string
          sub_department: string
          type_store: string
          unit_of_measure: string
          unit_pick: number
        }[]
      }
      get_minmax_view_for_calc: {
        Args: never
        Returns: {
          box_qty: number
          buying_status: string
          class: string
          department: string
          division: string
          item_type: string
          main_barcode: string
          max_val: number
          min_val: number
          pack_qty: number
          product_name_en: string
          product_name_la: string
          sku_code: string
          store_name: string
          sub_department: string
          type_store: string
          unit_of_measure: string
          unit_pick: number
        }[]
      }
      get_mv_range_store: {
        Args: never
        Returns: {
          avg_jmart: number | null
          avg_kokkok: number | null
          avg_kokkok_fc: number | null
          avg_per_store: Json | null
          avg_udee: number | null
          barcode_box: string | null
          barcode_pack: string | null
          box_qty: number | null
          buyer_code: string | null
          buying_status: string | null
          class: string | null
          department: string | null
          division: string | null
          division_group: string | null
          gm_buyer_code: string | null
          item_status: string | null
          item_type: string | null
          list_price: number | null
          main_barcode: string | null
          pack_qty: number | null
          packing_size_qty: number | null
          product_bu: string | null
          product_name_en: string | null
          product_name_la: string | null
          product_owner: string | null
          range_data: Json | null
          rank_sale: string | null
          sku_code: string | null
          standard_price: number | null
          sub_department: string | null
          unit_of_measure: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "mv_range_store"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_mv_range_store_filtered: {
        Args: {
          p_avg_stores?: string[]
          p_range_stores?: string[]
          p_type_stores?: string[]
        }
        Returns: {
          avg_jmart: number
          avg_kokkok: number
          avg_kokkok_fc: number
          avg_per_store: Json
          avg_udee: number
          barcode_box: string
          barcode_pack: string
          box_qty: number
          buyer_code: string
          buying_status: string
          class: string
          department: string
          division: string
          division_group: string
          gm_buyer_code: string
          item_status: string
          item_type: string
          list_price: number
          main_barcode: string
          pack_qty: number
          packing_size_qty: number
          product_bu: string
          product_name_en: string
          product_name_la: string
          product_owner: string
          range_data: Json
          rank_sale: string
          sku_code: string
          standard_price: number
          sub_department: string
          unit_of_measure: string
        }[]
      }
      get_po_cost_filter_options: { Args: never; Returns: Json }
      get_range_store_avg_type: {
        Args: never
        Returns: {
          avg_jmart: number
          avg_kokkok: number
          avg_kokkok_fc: number
          avg_udee: number
          sku_code: string
        }[]
      }
      get_range_store_data:
        | {
            Args: never
            Returns: {
              avg_jmart: number
              avg_kokkok: number
              avg_kokkok_fc: number
              avg_per_store: Json
              avg_udee: number
              barcode_box: string
              barcode_pack: string
              box_qty: number
              buyer_code: string
              buying_status: string
              class: string
              department: string
              division: string
              division_group: string
              gm_buyer_code: string
              item_status: string
              item_type: string
              list_price: number
              main_barcode: string
              pack_qty: number
              packing_size_qty: number
              product_bu: string
              product_name_en: string
              product_name_la: string
              product_owner: string
              range_data: Json
              rank_sale: string
              sku_code: string
              standard_price: number
              sub_department: string
              unit_of_measure: string
            }[]
          }
        | {
            Args: { p_skip_default_filters?: boolean }
            Returns: {
              avg_jmart: number
              avg_kokkok: number
              avg_kokkok_fc: number
              avg_per_store: Json
              avg_udee: number
              barcode_box: string
              barcode_pack: string
              box_qty: number
              buyer_code: string
              buying_status: string
              class: string
              department: string
              division: string
              division_group: string
              gm_buyer_code: string
              item_status: string
              item_type: string
              list_price: number
              main_barcode: string
              pack_qty: number
              packing_size_qty: number
              product_bu: string
              product_name_en: string
              product_name_la: string
              product_owner: string
              range_data: Json
              rank_sale: string
              sku_code: string
              standard_price: number
              sub_department: string
              unit_of_measure: string
            }[]
          }
      get_range_store_filter_lists: { Args: never; Returns: Json }
      get_range_store_lists: {
        Args: never
        Returns: {
          store_name: string
          type_store: string
        }[]
      }
      get_range_store_master: {
        Args: never
        Returns: {
          buyer_code: string
          class: string
          department: string
          division: string
          division_group: string
          gm_buyer_code: string
          main_barcode: string
          product_bu: string
          product_name_en: string
          product_name_la: string
          product_owner: string
          sku_code: string
          sub_department: string
        }[]
      }
      get_range_store_packbox: {
        Args: never
        Returns: {
          barcode_box: string
          barcode_pack: string
          box_qty: number
          pack_qty: number
          packing_size_qty: number
          sku_code: string
          unit_of_measure: string
        }[]
      }
      get_range_store_perstore: {
        Args: never
        Returns: {
          avg_per_store: Json
          range_data: Json
          sku_code: string
        }[]
      }
      get_range_store_status: {
        Args: never
        Returns: {
          buying_status: string
          item_status: string
          item_type: string
          list_price: number
          rank_sale: string
          sku_code: string
          standard_price: number
        }[]
      }
      get_srr_d2s_data: {
        Args: {
          p_classes?: string[]
          p_departments?: string[]
          p_division_groups?: string[]
          p_divisions?: string[]
          p_item_types?: string[]
          p_order_days?: string[]
          p_skip_default_filters?: boolean
          p_sku_codes?: string[]
          p_spc_names?: string[]
          p_sub_classes?: string[]
          p_sub_departments?: string[]
          p_vendor_codes?: string[]
        }
        Returns: {
          avg_sales_store: number
          buying_status: string
          class: string
          delivery_day: string
          department: string
          division: string
          division_group: string
          item_type: string
          leadtime: number
          main_barcode: string
          max_store: number
          min_store: number
          moq: number
          on_order_store: number
          order_cycle: number
          order_day: string
          po_cost: number
          po_cost_unit: number
          po_group: string
          product_name_en: string
          product_name_la: string
          rank_sales: string
          sku_code: string
          spc_name: string
          stock_dc: number
          stock_store: number
          store_name: string
          sub_class: string
          sub_department: string
          supplier_currency: string
          trade_term: string
          type_store: string
          unit_of_measure: string
          vendor_code: string
          vendor_current_status: string
          vendor_display_name: string
        }[]
      }
      get_srr_d2s_data_json: {
        Args: {
          p_classes?: string[]
          p_departments?: string[]
          p_division_groups?: string[]
          p_divisions?: string[]
          p_item_types?: string[]
          p_order_days?: string[]
          p_skip_default_filters?: boolean
          p_sku_codes?: string[]
          p_spc_names?: string[]
          p_sub_classes?: string[]
          p_sub_departments?: string[]
          p_vendor_codes?: string[]
        }
        Returns: Json
      }
      get_srr_data: {
        Args: {
          p_classes?: string[]
          p_departments?: string[]
          p_division_groups?: string[]
          p_divisions?: string[]
          p_item_types?: string[]
          p_order_days?: string[]
          p_skip_default_filters?: boolean
          p_sku_codes?: string[]
          p_spc_names?: string[]
          p_sub_classes?: string[]
          p_sub_departments?: string[]
          p_vendor_codes?: string[]
        }
        Returns: {
          avg_sales_jmart: number
          avg_sales_kokkok: number
          avg_sales_kokkok_fc: number
          avg_sales_udee: number
          buying_status: string
          class: string
          department: string
          division: string
          division_group: string
          item_type: string
          leadtime: number
          main_barcode: string
          max_jmart: number
          max_kokkok: number
          max_kokkok_fc: number
          max_udee: number
          min_jmart: number
          min_kokkok: number
          min_kokkok_fc: number
          min_udee: number
          moq: number
          on_order: number
          order_cycle: number
          order_day: string
          po_cost: number
          po_cost_unit: number
          po_group: string
          product_name_en: string
          product_name_la: string
          rank_sales: string
          sku_code: string
          spc_name: string
          stock_dc: number
          stock_jmart: number
          stock_kokkok: number
          stock_kokkok_fc: number
          stock_udee: number
          sub_class: string
          sub_department: string
          supplier_currency: string
          unit_of_measure: string
          vendor_code: string
          vendor_current_status: string
          vendor_display_name: string
        }[]
      }
      get_srr_data_json: {
        Args: {
          p_classes?: string[]
          p_departments?: string[]
          p_division_groups?: string[]
          p_divisions?: string[]
          p_item_types?: string[]
          p_order_days?: string[]
          p_skip_default_filters?: boolean
          p_sku_codes?: string[]
          p_spc_names?: string[]
          p_sub_classes?: string[]
          p_sub_departments?: string[]
          p_vendor_codes?: string[]
        }
        Returns: Json
      }
      get_srr_effective_vendors:
        | {
            Args: {
              p_buying_statuses?: string[]
              p_classes?: string[]
              p_departments?: string[]
              p_division_groups?: string[]
              p_divisions?: string[]
              p_item_types?: string[]
              p_po_groups?: string[]
              p_sub_classes?: string[]
              p_sub_departments?: string[]
            }
            Returns: {
              order_day: string
              spc_name: string
              vendor_code: string
            }[]
          }
        | {
            Args: {
              p_buying_statuses?: string[]
              p_classes?: string[]
              p_departments?: string[]
              p_division_groups?: string[]
              p_divisions?: string[]
              p_item_types?: string[]
              p_po_groups?: string[]
              p_skip_default_filters?: boolean
              p_sub_classes?: string[]
              p_sub_departments?: string[]
            }
            Returns: {
              order_day: string
              spc_name: string
              vendor_code: string
            }[]
          }
      get_srr_hierarchy_options:
        | {
            Args: never
            Returns: {
              class: string
              department: string
              division: string
              division_group: string
              sub_class: string
              sub_department: string
            }[]
          }
        | {
            Args: { p_skip_default_filters?: boolean }
            Returns: {
              class: string
              department: string
              division: string
              division_group: string
              sub_class: string
              sub_department: string
            }[]
          }
      get_srr_pre_filter_options: {
        Args: never
        Returns: {
          buying_statuses: string[]
          item_types: string[]
          po_groups: string[]
          stores: Json
          type_stores: string[]
        }[]
      }
      get_user_permissions: {
        Args: { _user_id: string }
        Returns: {
          column_perms: Json
          is_active: boolean
          menu_crud: Json
          permissions: string[]
          role_name: string
          spc_name: string
          vendor_code: string
          visible_menus: string[]
        }[]
      }
      has_permission: {
        Args: { _perm: string; _user_id: string }
        Returns: boolean
      }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      merge_minmax_doc:
        | {
            Args: {
              p_create_if_missing?: boolean
              p_doc_name?: string
              p_n_factor?: number
              p_payload: Json
              p_user_id?: string
            }
            Returns: {
              doc_id: string
              doc_name: string
              merged_count: number
              total_count: number
            }[]
          }
        | {
            Args: {
              p_create_if_missing?: boolean
              p_doc_id?: string
              p_doc_name?: string
              p_force_new?: boolean
              p_n_factor?: number
              p_payload: Json
              p_user_id?: string
            }
            Returns: {
              doc_id: string
              doc_name: string
              merged_count: number
              total_count: number
            }[]
          }
      range_store_view_info: {
        Args: never
        Returns: {
          last_sync: string
          row_count: number
        }[]
      }
      read_range_store_view:
        | {
            Args: {
              p_avg_stores?: string[]
              p_buyers?: string[]
              p_buying_statuses?: string[]
              p_classes?: string[]
              p_departments?: string[]
              p_division_groups?: string[]
              p_divisions?: string[]
              p_item_types?: string[]
              p_limit?: number
              p_owners?: string[]
              p_range_stores?: string[]
              p_skus?: string[]
              p_sub_departments?: string[]
              p_type_stores?: string[]
            }
            Returns: {
              avg_jmart: number | null
              avg_kokkok: number | null
              avg_kokkok_fc: number | null
              avg_per_store: Json | null
              avg_udee: number | null
              barcode_box: string | null
              barcode_pack: string | null
              box_qty: number | null
              buyer_code: string | null
              buying_status: string | null
              class: string | null
              department: string | null
              division: string | null
              division_group: string | null
              gm_buyer_code: string | null
              item_status: string | null
              item_type: string | null
              list_price: number | null
              main_barcode: string | null
              pack_qty: number | null
              packing_size_qty: number | null
              product_bu: string | null
              product_name_en: string | null
              product_name_la: string | null
              product_owner: string | null
              range_data: Json | null
              rank_sale: string | null
              sku_code: string
              standard_price: number | null
              sub_department: string | null
              synced_at: string
              unit_of_measure: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "range_store_view"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_avg_stores?: string[]
              p_buyers?: string[]
              p_buying_statuses?: string[]
              p_classes?: string[]
              p_departments?: string[]
              p_division_groups?: string[]
              p_divisions?: string[]
              p_item_types?: string[]
              p_limit?: number
              p_range_stores?: string[]
              p_skus?: string[]
              p_sub_departments?: string[]
              p_type_stores?: string[]
            }
            Returns: {
              avg_jmart: number | null
              avg_kokkok: number | null
              avg_kokkok_fc: number | null
              avg_per_store: Json | null
              avg_udee: number | null
              barcode_box: string | null
              barcode_pack: string | null
              box_qty: number | null
              buyer_code: string | null
              buying_status: string | null
              class: string | null
              department: string | null
              division: string | null
              division_group: string | null
              gm_buyer_code: string | null
              item_status: string | null
              item_type: string | null
              list_price: number | null
              main_barcode: string | null
              pack_qty: number | null
              packing_size_qty: number | null
              product_bu: string | null
              product_name_en: string | null
              product_name_la: string | null
              product_owner: string | null
              range_data: Json | null
              rank_sale: string | null
              sku_code: string
              standard_price: number | null
              sub_department: string | null
              synced_at: string
              unit_of_measure: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "range_store_view"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      refresh_mv_range_store: { Args: never; Returns: string }
      sync_range_store_view: {
        Args: never
        Returns: {
          ms: number
          rows_synced: number
        }[]
      }
      sync_range_store_view_skus: {
        Args: { p_skus: string[] }
        Returns: number
      }
      upsert_minmax_unit_pick: { Args: { p_rows: Json }; Returns: number }
      upsert_minmax_view: { Args: { p_rows: Json }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
