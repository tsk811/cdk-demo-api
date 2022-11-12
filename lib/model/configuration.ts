

//Common models
export interface CommonConfigs {
    vpcInfo: vpcConfigs
    account: Account
    appName: string
    artifactBucket: string
    cluster: string
    ecr: string
    fargateService: FargateService
    codeRepo: CodeRepo
    route53: Route53
    kms: KMS
    roles: Roles
    secretsManager: SecretsManager
}

export interface Account {
    nonProd: string
    prod: string
    region: string
}

export interface FargateService {
    name: string
    imageTag: string
    container: string
}

export interface CodeRepo {
    name: string
    defaultBranch: string
}

export interface Route53 {
    zoneId: string
    zoneName: string
    recordName: string
}

interface vpcConfigs {
    vpcId: string
    availabilityZones: string
    publicSubnets: string
    privateSubnets: string
    privateSubnetA: string
    privateSubnetB: string
    privateSubnetC: string
    publicSubnetA: string
    publicSubnetB: string
    publicSubnetC: string
}

export interface KMS {
    arn: string
}

export interface Roles {
    deployRole: string
    crossAccountRole: string
}


//Application related models
export interface ApplicationConfig {
    fargate: Fargate
    environment: string
}

export interface Task {
    memory: number
    cpu: number
    containerPort: number
}

export interface ALB {
    listenerPort: number
    targetPort: number
    healthyThreshold: number
    unhealthyThreshold: number
    healthcheckInterval: number
    healthcheckPath: string
    successCode: string
}

export interface Service {
    name: string
    desiredCount: number
    healthCheckGracePeriod: number
    minHealthPercentage: number
    cpuUtilizationTarget: number
    memoryUtilizationLimit: number
    scaleInCoolDown: number
    scaleOutCoolDown: number
}

export interface Fargate {
    task: Task
    alb: ALB
    service: Service
}

export interface SecretsManager {
    name: string
    key: string
}