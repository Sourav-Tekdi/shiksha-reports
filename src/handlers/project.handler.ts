import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../services/database.service';
import { TransformService } from 'src/constants/transformation/transform-service';
import {
  validateRequired,
  validateString,
  ValidationError,
} from '../types';

@Injectable()
export class ProjectHandler {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly transformService: TransformService,
  ) {}

  async handleProjectCreated(data: any) {
    try {
      // Validate required fields from the event structure
      validateRequired(data.projectTemplate, 'projectTemplate');
      validateRequired(data.projectTemplateTasks, 'projectTemplateTasks');
      validateString(data.projectTemplate.projectTemplateId, 'projectTemplateId');

      console.log(
        `[ProjectHandler] Processing project creation: projectTemplateId=${data.projectTemplate.projectTemplateId}, totalTasks=${data.totalTasks}`
      );

      // Transform and save project data
      const transformedProjectData = await this.transformService.transformProjectData(data);
      await this.dbService.upsertProject(transformedProjectData);

      console.log(
        `[ProjectHandler] Project created/updated successfully: ProjectId=${transformedProjectData.ProjectId}, ProjectName=${transformedProjectData.ProjectName}`
      );

      // Transform and save project tasks data
      const transformedTasksData = await this.transformService.transformProjectTasksData(data);
      const tasksResult = await this.dbService.upsertProjectTasks(transformedTasksData);

      console.log(
        `[ProjectHandler] Project tasks processed: ${tasksResult.count} tasks upserted for ProjectId=${transformedProjectData.ProjectId}`
      );

      return { 
        success: true, 
        projectId: transformedProjectData.ProjectId,
        tasksCount: tasksResult.count 
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(
          'Validation failed in handleProjectCreated:',
          error.message,
        );
        throw new Error(`Validation failed: ${error.message}`);
      }
      console.error('Error handling project creation:', error);
      throw error;
    }
  }

  async handleProjectSyncUpdate(data: any) {
    try {
      // Validate required fields from the direct message structure
      validateRequired(data._id, 'Project ID (_id)');
      validateString(data._id, '_id');
      validateRequired(data.solutionId, 'Solution ID');
      validateRequired(data.tasks, 'Tasks array');

      console.log(
        `[ProjectHandler] Processing project sync update: _id=${data._id}, solutionId=${data.solutionId}, userId=${data.userId}, status=${data.status}, totalTasks=${data.tasks?.length || 0}`
      );

      // Transform the sync message to ProjectTaskTracking records
      // Only completed tasks will be included
      const trackingRecords = await this.transformService.transformProjectTaskTrackingData(data);

      console.log(
        `[ProjectHandler] Found ${trackingRecords.length} completed tasks to track`
      );

      if (trackingRecords.length === 0) {
        console.log(
          `[ProjectHandler] No completed tasks to insert for project ${data.solutionId}`
        );
        return {
          success: true,
          projectId: data.solutionId,
          status: data.status,
          totalTasks: data.tasks?.length || 0,
          completedTasks: 0,
          inserted: 0,
          skipped: 0,
        };
      }

      // Insert tracking records (with duplicate checking)
      const result = await this.dbService.upsertProjectTaskTrackings(trackingRecords);

      console.log(
        `[ProjectHandler] Project sync complete: projectId=${data.solutionId}, inserted=${result.inserted}, skipped=${result.skipped}`
      );

      return {
        success: true,
        projectId: data.solutionId,
        status: data.status,
        totalTasks: data.tasks?.length || 0,
        completedTasks: trackingRecords.length,
        inserted: result.inserted,
        skipped: result.skipped,
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(
          'Validation failed in handleProjectSyncUpdate:',
          error.message,
        );
        throw new Error(`Validation failed: ${error.message}`);
      }
      console.error('Error handling project sync update:', error);
      throw error;
    }
  }

  async handleProjectTaskUpdate(data: any) {
    try {
      // Validate required fields
      validateRequired(data.solutionId, 'Solution ID (solutionId)');
      validateString(data.solutionId, 'solutionId');
      validateRequired(data.tasks, 'Tasks array');

      console.log(
        `[ProjectHandler] Processing project task update: solutionId=${data.solutionId}, totalTasks=${data.tasks?.length || 0}`
      );

      // Transform incoming tasks to ProjectTask entity format
      const incomingTasks = await this.transformService.transformProjectTaskUpdateData(data);
      const incomingTaskIds = new Set(incomingTasks.map(t => t.ProjectTaskId));

      console.log(
        `[ProjectHandler] Transformed ${incomingTasks.length} tasks (including children)`
      );

      // Get existing tasks from database
      const existingTasks = await this.dbService.getProjectTasksByProjectId(data.solutionId);
      const existingTaskIds = new Set(existingTasks.map(t => t.ProjectTaskId));

      console.log(
        `[ProjectHandler] Found ${existingTasks.length} existing tasks in database`
      );

      // Identify tasks to delete (exist in DB but not in incoming message)
      const tasksToDelete = existingTasks
        .filter(task => !incomingTaskIds.has(task.ProjectTaskId))
        .map(task => task.ProjectTaskId);

      // Delete removed tasks if any
      let deletedCount = 0;
      if (tasksToDelete.length > 0) {
        console.log(
          `[ProjectHandler] Deleting ${tasksToDelete.length} removed tasks`
        );
        const deleteResult = await this.dbService.deleteProjectTasks(tasksToDelete);
        deletedCount = deleteResult.affected || 0;
        console.log(
          `[ProjectHandler] Deleted ${deletedCount} tasks`
        );
      }

      // Upsert all incoming tasks (insert new + update existing)
      const upsertResult = await this.dbService.upsertProjectTasks(incomingTasks);

      console.log(
        `[ProjectHandler] Project task update complete: projectId=${data.solutionId}, upserted=${upsertResult.count}, deleted=${deletedCount}`
      );

      return {
        success: true,
        projectId: data.solutionId,
        totalIncomingTasks: incomingTasks.length,
        tasksUpserted: upsertResult.count,
        tasksDeleted: deletedCount,
        existingTasksCount: existingTasks.length,
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(
          'Validation failed in handleProjectTaskUpdate:',
          error.message,
        );
        throw new Error(`Validation failed: ${error.message}`);
      }
      console.error('Error handling project task update:', error);
      throw error;
    }
  }
}

