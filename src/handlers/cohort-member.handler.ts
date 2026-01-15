import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../services/database.service';

@Injectable()
export class CohortMemberHandler {
  private readonly logger = new Logger(CohortMemberHandler.name);

  constructor(private readonly dbService: DatabaseService) {}

  async handleCohortMemberUpsert(data: any) {
    try {
      this.logger.debug(
        `Incoming cohort member event: ${JSON.stringify(data)}`,
      );
      let cohortMembershipId: string | undefined = data?.cohortMembershipId;
      const userId: string | undefined = data?.userId || data?.UserID;
      const cohortId: string | undefined = data?.cohortId || data?.CohortID;
      const status: string | undefined = data?.status || data?.MemberStatus;
      const academicYearId: string | undefined =
        data?.academicYearId || data?.AcademicYearID;

      // If cohortMembershipId not provided, try to resolve or create using (userId, cohortId)
      if (!cohortMembershipId && userId && cohortId) {
        const existing = await this.dbService.findCohortMember(
          userId,
          cohortId,
        );
        if (existing) {
          cohortMembershipId = existing.CohortMemberID as any;
        }
      }

      if (!cohortMembershipId) {
        this.logger.warn(
          'Missing cohortMembershipId and unable to resolve from userId/cohortId',
        );
        return;
      }

      // Only update if record exists for this cohortMembershipId
      const existingById = await this.dbService.findCohortMemberById(
        cohortMembershipId,
      );
      if (!existingById) {
        this.logger.warn(
          `CohortMember not found. Skipping update | cohortMembershipId=${cohortMembershipId}`,
        );
        return;
      }

      const customFields: any[] = Array.isArray(data?.customFields)
        ? data.customFields
        : [];

      // Extract target fields by label (name)
      const wanted = new Map<string, string>([
        ['subject', 'Subject'],
        ['fees', 'Fees'],
        ['registration', 'Registration'],
        ['board', 'Board'],
      ]);

      const updates: Record<string, string | null | undefined> = {};

      // Include status if provided
      if (status) {
        updates['MemberStatus'] = status;
      }

      // Path A: Support a direct fields map: { fields: { Subject: 'x', Fees: 'y', ... } }
      if (
        data?.fields &&
        typeof data.fields === 'object' &&
        !Array.isArray(data.fields)
      ) {
        for (const [name, val] of Object.entries<any>(data.fields)) {
          const key = (name || '').toString().trim().toLowerCase();
          if (!wanted.has(key)) continue;
          const columnName = wanted.get(key) as string;
          updates[columnName] = val == null ? null : String(val);
        }
        this.logger.debug(
          `Parsed fields map for ${cohortMembershipId} | keys=${Object.keys(updates).join(',')}`,
        );
      }

      for (const field of customFields) {
        const label: string = (field?.label || '').toString();
        const key = label.trim().toLowerCase();
        // Store the value as-is without any transformation
        const value = field?.value;

        // Match only by label (case-insensitive)
        if (!wanted.has(key)) continue;
        const columnName = wanted.get(key) as string;
        updates[columnName] = value;
      }

      if (Object.keys(updates).length === 0) {
        this.logger.debug(
          `No updates to perform | cohortMembershipId=${cohortMembershipId} | status=${status || 'none'} | customFieldsLen=${customFields.length} | fieldsKeys=${
            data?.fields ? Object.keys(data.fields).join(',') : 'none'
          }`,
        );
        return;
      }

      this.logger.debug(
        `Updating fields for ${cohortMembershipId} | updates=${JSON.stringify(updates)}`,
      );
      await this.dbService.updateCohortMemberCustomFieldsById(
        cohortMembershipId,
        updates,
      );
      this.logger.log(
        `Updated cohort member fields for ${cohortMembershipId}: ${Object.keys(
          updates,
        ).join(', ')}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to upsert cohort member fields: ${error.message} | stack=${error?.stack}`,
      );
      throw error;
    }
  }
}
