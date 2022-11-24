import { Duration, Stack, StackProps, RemovalPolicy, CfnParameter } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as r53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

import { CommonConfigs, ApplicationConfig } from './model/configuration';

export interface ApplicationStackProps extends StackProps {
  readonly commonConfigs: CommonConfigs;
  readonly appConfigs: ApplicationConfig;
  readonly stackName: string;
}

export class ApplicationStack extends Stack {

  public readonly lambdaCode: lambda.CfnParametersCode;

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const commonConfigs = props.commonConfigs;
    const appConfigs = props.appConfigs;
    const stackName = props.stackName
    const imageTag = new CfnParameter(this, 'imageTag', {
      type: 'String',
      description: 'Image tag for deployment.',
    });
    this.lambdaCode = lambda.Code.fromCfnParameters();

    function getValueFromParameterStore(name: string, stack: Construct) {
      return (ssm.StringParameter.fromStringParameterAttributes(stack, `${name}Parameter`, {
        parameterName: name
      })).stringValue
    }

    function getSubnet(name: string, stack: Construct) {
      return ec2.Subnet.fromSubnetId(stack, `${name}Parameter`, name)
    }


    const vpcId = getValueFromParameterStore(commonConfigs.vpcInfo.vpcId, this)
    const availabilityZones = getValueFromParameterStore(commonConfigs.vpcInfo.availabilityZones, this)
    const publicSubnets = getValueFromParameterStore(commonConfigs.vpcInfo.publicSubnets, this)
    const privateSubnets = getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnets, this)

    //Needed Imports
    const vpc = ec2.Vpc.fromVpcAttributes(this, `${stackName}VPCImport`, {
      vpcId: vpcId,
      availabilityZones: [availabilityZones],
      publicSubnetIds: [publicSubnets],
      privateSubnetIds: [privateSubnets]

    })


    const ecsCluster = ecs.Cluster.fromClusterAttributes(this, `${stackName}Cluster`, {
      clusterName: getValueFromParameterStore(commonConfigs.cluster, this),
      vpc: vpc,
      securityGroups: []
    }
    )


    const ecrRepo = ecr.Repository.fromRepositoryName(this, "demo-api-repo",
      getValueFromParameterStore(commonConfigs.ecr, this))

    //Commented as domain is not available now. Use it as needed.
    /*
    const hostedZone = r53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone',{
      hostedZoneId: getValueFromParameterStore(commonConfigs.route53.zoneId, this),
      zoneName: getValueFromParameterStore(commonConfigs.route53.zoneName, this)
    })
    */

    //S3 bucket to store files from ecs.
    const demoAPIs3Bucket = new s3.Bucket(this, `${this.stackName}demoAPIBucket`, {
      bucketName: `demo-api-bucket-${props.env?.account}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false
    })

    //Sample lambda function
    const lambdaFunction = new lambda.Function(this, `${stackName}Lambda`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: this.lambdaCode,
      handler: "app.handler",
      timeout: Duration.seconds(30),
      memorySize: 512

    })


    const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, `${stackName}${appConfigs.fargate.service.name}TaskDefinition`, {
      cpu: appConfigs.fargate.task.cpu,
      memoryLimitMiB: appConfigs.fargate.task.memory,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX
      },
    })

    demoAPIs3Bucket.grantReadWrite(fargateTaskDefinition.taskRole);

    // Create Container Definition
    const container = fargateTaskDefinition.addContainer(commonConfigs.fargateService.container, {
      image: ecs.ContainerImage.fromEcrRepository(
        ecrRepo,
        imageTag.valueAsString),
      //Add tags as required.
      environment: {
        "NAME": "demo-api",
        "BUCKET": demoAPIs3Bucket.bucketName
      },
    })

    //Add Container to Host port mapping
    container.addPortMappings({
      containerPort: appConfigs.fargate.task.containerPort
    }
    )

    //Create Fargate service
    const fargateService = new ecs.FargateService(this, `${stackName}${appConfigs.fargate.service.name}Service`, {
      cluster: ecsCluster,
      // Comment the below to handle the deployment failures manually
      circuitBreaker: { rollback: true },
      taskDefinition: fargateTaskDefinition, vpcSubnets: {
        subnets: [
          //explicit subnet selection is needed or else cdk will choose default vpc and cause errors
          getSubnet(getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetA, this), this),
          getSubnet(getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetB, this), this),
          getSubnet(getValueFromParameterStore(commonConfigs.vpcInfo.privateSubnetC, this), this)
        ],
      },
      assignPublicIp: false,
      desiredCount: appConfigs.fargate.service.desiredCount,
      healthCheckGracePeriod: Duration.seconds(appConfigs.fargate.service.healthCheckGracePeriod),
      minHealthyPercent: appConfigs.fargate.service.minHealthPercentage,
      //Rolling Deployment
      deploymentController: { type: ecs.DeploymentControllerType.ECS },
      serviceName: appConfigs.fargate.service.name
    });

    //Create an ALB for fargate service
    const alb = new elb.ApplicationLoadBalancer(this, `${stackName}ALB`, {
      vpc: vpc,
      vpcSubnets: {
        subnets: [
          //explicit subnet selection is needed or else cdk will choose default vpc and cause errors
          getSubnet(getValueFromParameterStore(commonConfigs.vpcInfo.publicSubnetA, this), this),
          getSubnet(getValueFromParameterStore(commonConfigs.vpcInfo.publicSubnetB, this), this),
          getSubnet(getValueFromParameterStore(commonConfigs.vpcInfo.publicSubnetC, this), this)
        ],
      },
      internetFacing: true,
    })

    //ALB Listener
    const albListener = alb.addListener(`${stackName}Listener`, {
      port: appConfigs.fargate.alb.listenerPort,
    })


    // ALB Target gropup with health check config
    const appTargetGroup = new elb.ApplicationTargetGroup(this, `${stackName}TargetGroup`, {
      deregistrationDelay: Duration.seconds(100),
      healthCheck: {
        enabled: true,
        healthyHttpCodes: appConfigs.fargate.alb.successCode,
        healthyThresholdCount: appConfigs.fargate.alb.healthyThreshold,
        interval: Duration.seconds(appConfigs.fargate.alb.healthcheckInterval),
        path: appConfigs.fargate.alb.healthcheckPath,
        unhealthyThresholdCount: appConfigs.fargate.alb.unhealthyThreshold,
        protocol: elb.Protocol.HTTP,
        port: appConfigs.fargate.alb.targetPort.toString(),
      },
      port: appConfigs.fargate.alb.targetPort,
      vpc: vpc,
      protocol: elb.ApplicationProtocol.HTTP,
      targetType: elb.TargetType.IP
    })

    //Add the target group to the ALB Listener
    albListener.addTargetGroups("tgAttachment", { targetGroups: [appTargetGroup] })

    //Registers the containers behind Fargate service to the Target Group
    fargateService.attachToApplicationTargetGroup(appTargetGroup)

    //Auto Scaling configuration for Fargate service

    const scalingConfig = fargateService.autoScaleTaskCount({
      maxCapacity: 8,
      minCapacity: appConfigs.fargate.service.desiredCount
    })

    scalingConfig.scaleOnCpuUtilization("CPUBasedScaling", {
      targetUtilizationPercent: appConfigs.fargate.service.cpuUtilizationTarget,
      policyName: `${fargateService.serviceName}CPUScaling`,
      scaleInCooldown: Duration.seconds(appConfigs.fargate.service.scaleInCoolDown),
      scaleOutCooldown: Duration.seconds(appConfigs.fargate.service.scaleOutCoolDown),

    })

    scalingConfig.scaleOnMemoryUtilization("MemoryBasedScaling", {
      targetUtilizationPercent: appConfigs.fargate.service.memoryUtilizationLimit,
      policyName: `${fargateService.serviceName}MemoryScaling`,
      scaleInCooldown: Duration.seconds(appConfigs.fargate.service.scaleInCoolDown),
      scaleOutCooldown: Duration.seconds(appConfigs.fargate.service.scaleOutCoolDown),
    })

    //Commented as domain is not available now. Use it as needed.
    /*const aRecord = new r53.ARecord(this, 'demoAPIr53Record',{
      zone: hostedZone,
      target: r53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
      recordName: commonConfigs.route53.recordName
    })
    */
    

  }


}
