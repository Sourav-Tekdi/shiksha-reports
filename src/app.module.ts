import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { KafkaConsumerService } from './kafka/kafka-consumer';
import { DatabaseService } from './services/database.service';
import { User } from './entities/user.entity';
import { UserHandler } from './handlers/user.handler';
import { TransformService } from './constants/transformation/transform-service';
import { CourseHandler } from './handlers/course.handler';
import { Course } from './entities/course.entity';
import { QuestionSet } from './entities/question-set.entity';
import { ExternalApiService } from './services/external-api.service';
import { CronJobService } from './services/cron-job.service';
import { CronJobController } from './controllers/cron-job.controller';
import cronConfig from './config/cron.config';
import { DailyAttendanceReport } from './entities/daily-attendance-report.entity';
import { AttendanceHandler } from './handlers/attendance.handler';
import { AssessmentHandler } from './handlers/assessment.handler';
import { Event } from './entities/event.entity';
import { EventDetails } from './entities/event-details.entity';
import { EventRepetition } from './entities/event-repetition.entity';
import { EventHandler } from './handlers/event.handler';
import { CohortMember } from './entities/cohort-member.entity';
import { Cohort } from './entities/cohort.entity';
import { AttendanceTracker } from './entities/attendance-tracker.entity';
import { AssessmentTracker } from './entities/assessment-tracker.entity';
import { CourseTracker } from './entities/course-tracker.entity';
import { ContentTracker } from './entities/content-tracker.entity';
import { ContentHandler } from './handlers/content.handler';
import { CohortHandler } from './handlers/cohort.handler';
import { RegistrationTracker } from './entities/registration-tracker.entity';

@Module({
  imports: [
    // First import ConfigModule
    ConfigModule.forRoot({
      isGlobal: true, // makes ConfigModule available everywhere
      load: [cronConfig], // Load cron configuration
    }),

    // Schedule module for cron jobs
    ScheduleModule.forRoot(),

    // Then use dynamic config in TypeOrm
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        database: configService.get('DB_DATABASE'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        // entities: [
        //   User
        // ],
        autoLoadEntities: true,
      }),
      inject: [ConfigService],
    }),

    // Register the entity for repository injection
    TypeOrmModule.forFeature([
      User,
      DailyAttendanceReport,
      Event,
      EventDetails,
      EventRepetition,
      CohortMember,
      Cohort,
      AttendanceTracker,
      AssessmentTracker,
      CourseTracker,
      ContentTracker,
      RegistrationTracker,
      Course, // Add Course entity for cron job service
      QuestionSet, // Add QuestionSet entity for future use
    ]),
  ],
  controllers: [
    CronJobController,
  ],
  providers: [
    KafkaConsumerService,
    DatabaseService,
    UserHandler,
    CourseHandler,
    ContentHandler,
    AttendanceHandler,
    AssessmentHandler,
    EventHandler,
    CohortHandler,
    TransformService,
    // Cron job services
    ExternalApiService,
    CronJobService,
  ],
})
export class AppModule {}
