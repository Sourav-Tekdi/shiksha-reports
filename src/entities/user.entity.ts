import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'Users' })
export class User {
  @PrimaryColumn('uuid', { name: 'UserID' })
  userId: string;

  @Column({ name: 'UserName', type: 'varchar', length: 100, nullable: true })
  username?: string;

  @Column({
    name: 'UserFullName',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  fullName?: string;

  @Column({ name: 'UserEmail', type: 'varchar', length: 150, nullable: true })
  email?: string;

  @Column({ name: 'UserDoB', type: 'date', nullable: true })
  dob?: string;

  @Column({ name: 'UserMobile', type: 'varchar', length: 20, nullable: true })
  mobile?: string;

  @Column({ name: 'UserGender', type: 'varchar', length: 20, nullable: true })
  gender?: string;

  @Column({
    name: 'UserIsActive',
    type: 'boolean',
    nullable: true,
    default: () => 'true',
  })
  status?: boolean;

  @Column({ name: 'UserStateID', type: 'varchar', length: 50, nullable: true })
  stateId?: string;

  @Column({
    name: 'UserDistrictID',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  districtId?: string;

  @Column({ name: 'UserBlockID', type: 'varchar', length: 50, nullable: true })
  blockId?: string;

  @Column({
    name: 'UserVillageID',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  villageId?: string;

  @Column({
    name: 'UserPreferredModeOfLearning',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  preferredModeOfLearning?: string;

  @Column({
    name: 'UserMotherName',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  userMotherName?: string;

  @Column({
    name: 'UserWorkDomain',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  userWorkDomain?: string;

  @Column({
    name: 'UserFatherName',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  userFatherName?: string;

  @Column({
    name: 'UserSpouseName',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  userSpouseName?: string;

  @Column({
    name: 'UserPhoneType',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  phoneTypeAccessible?: string;

  @Column({
    name: 'UserWhatDoYouWantToBecome',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  userWhatDoYouWantToBecome?: string;

  @Column({ name: 'UserClass', type: 'varchar', length: 50, nullable: true })
  userClass?: string;

  @Column({
    name: 'UserPreferredLanguage',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  userPreferredLanguage?: string;

  @Column({
    name: 'UserParentPhone',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  userParentPhone?: string;

  @Column({
    name: 'UserGuardianRelation',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  userGuardianRelation?: string;

  @Column({
    name: 'UserSubjectTaught',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  userSubjectTaught?: string;

  @Column({
    name: 'UserMaritalStatus',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  userMaritalStatus?: string;

  @Column({ name: 'UserGrade', type: 'varchar', length: 50, nullable: true })
  userGrade?: string;

  @Column({ name: 'UserTrainingCheck', type: 'boolean', nullable: true })
  userTrainingCheck?: boolean;

  @Column({ name: 'UserDropOutReason', type: 'text', nullable: true })
  userDropOutReason?: string;

  @Column({ name: 'UserOwnPhoneCheck', type: 'boolean', nullable: true })
  userOwnPhoneCheck?: boolean;

  @Column({
    name: 'UserEnrollmentNumber',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  userEnrollmentNumber?: string;

  @Column({
    name: 'UserDesignation',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  userDesignation?: string;

  @Column({ name: 'UserBoard', type: 'varchar', length: 100, nullable: true })
  userBoard?: string;

  @Column({ name: 'UserSubject', type: 'varchar', length: 150, nullable: true })
  userSubject?: string;

  @Column({
    name: 'UserMainSubject',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  userMainSubject?: string;

  @Column({ name: 'UserMedium', type: 'varchar', length: 100, nullable: true })
  userMedium?: string;

  @Column({
    name: 'UserGuardianName',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  userGuardianName?: string;

  @Column({
    name: 'CreatedAt',
    type: 'timestamp',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt?: Date;

  @Column({
    name: 'UpdatedAt',
    type: 'timestamp',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt?: Date;

  @Column({ name: 'CreatedBy', type: 'varchar', length: 100, nullable: true })
  createdBy?: string;

  @Column({ name: 'UpdatedBy', type: 'varchar', length: 100, nullable: true })
  updatedBy?: string;

  @Column({
    name: 'UserNumOfChildrenWorkingWith',
    type: 'text',
    nullable: true,
  })
  userNumOfChildrenWorkingWith?: string;
  
  @Column({
    name: 'JobFamily',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  jobFamily?: string;

  @Column({
    name: 'PSU',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  psu?: string;

  @Column({
    name: 'GroupMembership',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  groupMembership?: string;

  @Column({ name: 'EMPManager', type: 'text', nullable: true })
  empManager?: string;

  @Column({ name: 'ERPUserID', type: 'text', nullable: true })
  erpUserId?: string;

  @Column({ name: 'IsManager', type: 'text', nullable: true })
  isManager?: string;

  @Column({ name: 'UserLastLogin', type: "timestamptz", nullable: true })
  userLastLogin: Date | null; // Timestamp for last login

  @Column({ name: 'UserCallLogs', type: 'json', nullable: true })
  userCallLogs?: string | object | null;

  @Column({ name: 'UserTypeOfLearner', type: 'text', nullable: true })
  userTypeOfLearner?: string;

  @Column({ name: 'UserInterestedContent', type: 'text', nullable: true })
  userInterestedContent?: string;

  @Column({ name: 'UserInterestedToJoin', type: 'boolean', nullable: true })
  userInterestedToJoin?: boolean;

  @Column({ name: 'UserIsVolunteer', type: 'boolean', nullable: true })
  userIsVolunteer?: boolean;

  @Column({ name: 'UserWhatProgramAreYouPartOf', type: 'text', nullable: true })
  userWhatProgramAreYouPartOf?: string;

  @Column({ name: 'UserSupportNeeded', type: 'text', nullable: true })
  userSupportNeeded?: string;

}
