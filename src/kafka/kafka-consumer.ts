import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { UserHandler } from '../handlers/user.handler';
import { CourseHandler } from 'src/handlers/course.handler';
import { ContentHandler } from 'src/handlers/content.handler';
import { AttendanceHandler } from '../handlers/attendance.handler';
import { AssessmentHandler } from '../handlers/assessment.handler';
import { EventHandler } from 'src/handlers/event.handler';
import { CohortHandler } from 'src/handlers/cohort.handler';
import { CohortMemberHandler } from 'src/handlers/cohort-member.handler';
import { ProjectHandler } from 'src/handlers/project.handler';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly logger = new Logger(KafkaConsumerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly userHandler: UserHandler,
    private readonly courseHandler: CourseHandler,
    private readonly contentHandler: ContentHandler,
    private readonly attendanceHandler: AttendanceHandler,
    private readonly assessmentHandler: AssessmentHandler,
    private readonly eventHandler: EventHandler,
    private readonly cohortHandler: CohortHandler,
    private readonly cohortMemberHandler: CohortMemberHandler,
    private readonly projectHandler: ProjectHandler,
  ) {
    const brokers = this.configService
      .get<string>('KAFKA_BROKERS', 'localhost:9092')
      .split(',');
    const clientId = this.configService.get<string>(
      'KAFKA_CLIENT_ID',
      'centralized-consumer',
    );

    this.kafka = new Kafka({
      clientId,
      brokers,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });

    const groupId = this.configService.get<string>(
      'KAFKA_CONSUMER_GROUP_ID',
      'centralized-consumer-group',
    );
    this.consumer = this.kafka.consumer({ groupId });
  }

  async onModuleInit() {
    try {
      await this.connectConsumer();
      await this.subscribeToTopics();
      await this.runConsumer();
      this.logger.log('Kafka consumer initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Kafka consumer', error.stack);
    }
  }

  async onModuleDestroy() {
    await this.disconnectConsumer();
  }

  private async connectConsumer() {
    try {
      await this.consumer.connect();
      this.logger.log('Kafka consumer connected');
    } catch (error) {
      this.logger.error(
        `Failed to connect Kafka consumer: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async disconnectConsumer() {
    try {
      await this.consumer.disconnect();
      this.logger.log('Kafka consumer disconnected');
    } catch (error) {
      this.logger.error(
        `Failed to disconnect Kafka consumer: ${error.message}`,
        error.stack,
      );
    }
  }

  private async subscribeToTopics() {
    const topics = this.configService
      .get<string>('KAFKA_TOPICS', 'user-topic')
      .split(',');
    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
      this.logger.log(`Subscribed to Kafka topic: ${topic}`);
    }
  }

  private async runConsumer() {
    await this.consumer.run({
      eachMessage: async ({
        topic,
        partition,
        message,
      }: EachMessagePayload) => {
        try {
          const value = message.value?.toString();

          if (!value) {
            this.logger.warn('Received empty Kafka message');
            return;
          }

          const event = JSON.parse(value);
          // this.logger.debug(`Received event from topic [${topic}]: ${value}`);

          await this.processEvent(topic, event);
        } catch (error) {
          this.logger.error(
            `Error processing Kafka message: ${error.message}`,
            error.stack,
          );
          // Optionally: Send to DLQ
        }
      },
    });
  }

  private async processEvent(topic: string, event: any) {
    // Check if message has standard wrapper format (eventType + data)
    if (event.eventType && event.data) {
      // Standard wrapped format
      await this.processWrappedEvent(topic, event.eventType, event.data);
      return;
    }

    // Direct message format (no wrapper) - infer event type from topic and message
    this.logger.log(
      `Received direct message format from topic [${topic}], inferring event type...`,
    );
    await this.processDirectMessage(topic, event);
  }

  private async processWrappedEvent(topic: string, eventType: string, data: any) {
    if (!eventType || !data) {
      this.logger.warn(
        `Invalid event received from topic ${topic}. EventType: ${eventType}, Data present: ${!!data}`,
      );
      return;
    }

    // Special routing for course enrollment events regardless of topic
    if (eventType === 'COURSE_ENROLLMENT_CREATED') {
      await this.handleCourseEvent(eventType, data);
      return;
    }

    if (eventType === 'COURSE_STATUS_UPDATED') {
      await this.handleCourseEvent(eventType, data);
      return;
    }

    // Special routing for content tracking events regardless of topic
    if (eventType === 'CONTENT_TRACKING_CREATED') {
      await this.handleContentEvent(eventType, data);
      return;
    }

    // Special routing for project planner events regardless of topic
    if (eventType === 'COURSE_PLANNER_PROJECT_CREATED') {
      await this.handleProjectEvent(eventType, data);
      return;
    }

    switch (topic) {
      case 'user-topic':
        await this.handleUserEvent(eventType, data);
        break;

      case 'event-topic':
        await this.handleEventEvent(eventType, data);
        break;

      case 'attendance-topic':
        await this.handleAttendanceEvent(eventType, data);
        break;

      case 'tracking-topic':
        await this.handleAssessmentEvent(eventType, data);
        break;

      case 'project-topic':
        await this.handleProjectEvent(eventType, data);
        break;

      default:
        this.logger.warn(`Unhandled Kafka topic: ${topic}`);
    }
  }

  private async handleUserEvent(eventType: string, data: any) {
    switch (eventType) {
      case 'USER_CREATED':
        return this.userHandler.handleUserCreated(data);
        
      case 'USER_UPDATED':
        return this.userHandler.handleUserUpsert(data);

      case 'USER_DELETED':
        return this.userHandler.handleUserDelete(data);

      case 'USER_TENANT_STATUS_UPDATE':
        return this.userHandler.handleUserTenantStatusUpdate(data);

      case 'USER_TENANT_MAPPING':
        return this.userHandler.handleUserTenantMapping(data);
      case 'USER_LOGIN':
        return this.userHandler.handleUserLastLogin(data);

      case 'COHORT_CREATED':
      case 'COHORT_UPDATED':
        return this.cohortHandler.handleCohortUpsert(data);

      case 'COHORT_DELETED':
        return this.cohortHandler.handleCohortDelete(data);

      case 'COHORT_MEMBER_CREATED':
      case 'COHORT_MEMBER_UPDATED':
        return this.cohortMemberHandler.handleCohortMemberUpsert(data);
      default:
        this.logger.warn(`Unhandled user eventType: ${eventType}`);
    }
  }

  private async handleEventEvent(eventType: string, data: any) {
    this.logger.log(`Handling event-event type: ${eventType}`);
    switch (eventType) {
      case 'EVENT_CREATED':
      case 'EVENT_UPDATED':
        return this.eventHandler.handleEventUpsert(data);

      case 'EVENT_DELETED':
        return this.eventHandler.handleEventDelete(data);

      default:
        this.logger.warn(`Unhandled event eventType: ${eventType}`);
    }
  }

  private async handleAttendanceEvent(eventType: string, data: any) {
    this.logger.log(`Handling attendance-event type: ${eventType}`);
    switch (eventType) {
      case 'ATTENDANCE_CREATED':
      case 'ATTENDANCE_UPDATED':
        return this.attendanceHandler.handleAttendanceUpsert(data);

      case 'ATTENDANCE_DELETED':
        return this.attendanceHandler.handleAttendanceDelete(data);

      default:
        this.logger.warn(`Unhandled attendance eventType: ${eventType}`);
    }
  }

  private async handleAssessmentEvent(eventType: string, data: any) {
    this.logger.log(`Handling assessment-event type: ${eventType}`);
    switch (eventType) {
      case 'ASSESSMENT_CREATED':
      case 'ASSESSMENT_UPDATED':
        return this.assessmentHandler.handleAssessmentUpsert(data);

      case 'ASSESSMENT_DELETED':
        return this.assessmentHandler.handleAssessmentDelete(data);

      default:
        this.logger.warn(`Unhandled assessment eventType: ${eventType}`);
    }
  }
  private async handleCourseEvent(eventType: string, data: any) {
    this.logger.log(`Handling course-event type: ${eventType}`);
    switch (eventType) {
      case 'COURSE_ENROLLMENT_CREATED':
        return this.courseHandler.handleCourseEnrollmentCreated(data);
      case 'COURSE_STATUS_UPDATED':
        return this.courseHandler.handleCourseStatusUpdated(data);
      default:
        this.logger.warn(`Unhandled assessment eventType: ${eventType}`);
    }
  }

  private async handleContentEvent(eventType: string, data: any) {
    this.logger.log(`Handling content-event type: ${eventType}`);
    switch (eventType) {
      case 'CONTENT_TRACKING_CREATED':
        return this.contentHandler.handleContentTrackingCreated(data);
      default:
        this.logger.warn(`Unhandled content eventType: ${eventType}`);
    }
  }

  private async handleProjectEvent(eventType: string, data: any) {
    this.logger.log(`Handling project-event type: ${eventType}`);
    switch (eventType) {
      case 'COURSE_PLANNER_PROJECT_CREATED':
        return this.projectHandler.handleProjectCreated(data);
      case 'PROJECT_SYNC_CREATED':
      case 'PROJECT_SYNC_UPDATED':
        return this.projectHandler.handleProjectSyncUpdate(data);
      case 'PROJECT_TASK_UPDATED':
        return this.projectHandler.handleProjectTaskUpdate(data);
      default:
        this.logger.warn(`Unhandled project eventType: ${eventType}`);
    }
  }

  /**
   * Handle direct messages (without eventType/data wrapper)
   * Infer event type based on topic and message structure
   */
  private async processDirectMessage(topic: string, message: any) {
    try {
      switch (topic) {
        case 'project-sync-topic':
          // Infer event type based on message fields
          const eventType = this.inferProjectSyncEventType(message);
          this.logger.log(
            `Inferred event type: ${eventType} for topic: ${topic}`,
          );
          await this.handleProjectEvent(eventType, message);
          break;

        case 'project-update-topic':
          // Handle project task updates
          this.logger.log(
            `Processing PROJECT_TASK_UPDATED event from topic: ${topic}`,
          );
          await this.handleProjectEvent('PROJECT_TASK_UPDATED', message);
          break;

        default:
          this.logger.warn(
            `Received direct message from unmapped topic: ${topic}`,
          );
      }
    } catch (error) {
      this.logger.error(
        `Error processing direct message from topic ${topic}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Infer event type for project-sync-topic messages
   */
  private inferProjectSyncEventType(message: any): string {
    // Check if this is a new project or an update
    if (message.createdAt && message.updatedAt) {
      const created = new Date(message.createdAt);
      const updated = new Date(message.updatedAt);
      
      // If created and updated are very close (within 1 second), it's likely a creation event
      const timeDiff = Math.abs(updated.getTime() - created.getTime());
      if (timeDiff < 1000) {
        return 'PROJECT_SYNC_CREATED';
      }
    }

    // Default to update event
    return 'PROJECT_SYNC_UPDATED';
  }
}
