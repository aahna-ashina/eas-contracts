import Contracts from '../components/Contracts';
import { EIP712Verifier, SchemaRegistry, TestEAS } from '../typechain-types';
import { ZERO_ADDRESS, ZERO_BYTES32 } from '../utils/Constants';
import {
  expectAttestation,
  expectFailedAttestation,
  expectFailedMultiAttestations,
  expectFailedMultiRevocations,
  expectFailedRevocation,
  expectMultiAttestations,
  expectMultiRevocations,
  expectRevocation,
  getSchemaUUID,
  getUUIDFromAttestTx,
  SignatureType
} from './helpers/EAS';
import { EIP712Utils } from './helpers/EIP712Utils';
import { duration, latest } from './helpers/Time';
import { createWallet } from './helpers/Wallet';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { Wallet } from 'ethers';
import { ethers } from 'hardhat';

const {
  utils: { formatBytes32String }
} = ethers;

describe('EAS', () => {
  let accounts: SignerWithAddress[];
  let sender: Wallet;
  let sender2: Wallet;
  let recipient: SignerWithAddress;
  let recipient2: SignerWithAddress;

  let registry: SchemaRegistry;
  let verifier: EIP712Verifier;
  let eas: TestEAS;
  let eip712Utils: EIP712Utils;

  before(async () => {
    accounts = await ethers.getSigners();

    [recipient, recipient2] = accounts;
  });

  beforeEach(async () => {
    sender = await createWallet();
    sender2 = await createWallet();

    registry = await Contracts.SchemaRegistry.deploy();
    verifier = await Contracts.EIP712Verifier.deploy();
    eip712Utils = await EIP712Utils.fromVerifier(verifier);

    eas = await Contracts.TestEAS.deploy(registry.address, verifier.address);

    const now = await latest();
    expect(await eas.getTime()).to.equal(now);
    await eas.setTime(now);
    expect(await eas.getTime()).to.equal(now);
  });

  describe('construction', () => {
    it('should revert when initialized with an empty schema registry', async () => {
      await expect(Contracts.EAS.deploy(ZERO_ADDRESS, verifier.address)).to.be.revertedWith('InvalidRegistry');
    });

    it('should revert when initialized with an empty EIP712 verifier', async () => {
      await expect(Contracts.EAS.deploy(registry.address, ZERO_ADDRESS)).to.be.revertedWith('InvalidVerifier');
    });

    it('should be properly initialized', async () => {
      expect(await eas.VERSION()).to.equal('0.21');
      expect(await eas.getSchemaRegistry()).to.equal(registry.address);
      expect(await eas.getEIP712Verifier()).to.equal(verifier.address);
    });
  });

  describe('attesting', () => {
    let expirationTime: number;
    const data = '0x1234';

    beforeEach(async () => {
      expirationTime = (await eas.getTime()) + duration.days(30);
    });

    for (const signatureType of [SignatureType.Direct, SignatureType.Delegated]) {
      context(`via ${signatureType} attestation`, () => {
        it('should revert when attesting to an unregistered schema', async () => {
          await expectFailedAttestation(
            {
              eas,
              verifier,
              eip712Utils
            },
            formatBytes32String('BAD'),
            {
              recipient: recipient.address,
              expirationTime,
              data
            },
            { from: sender },
            'InvalidSchema'
          );

          // All requests are to unregistered schemas
          await expectFailedMultiAttestations(
            {
              eas,
              verifier,
              eip712Utils
            },
            [
              {
                schema: formatBytes32String('BAD'),
                requests: [
                  {
                    recipient: recipient.address,
                    expirationTime,
                    data
                  }
                ]
              },
              {
                schema: formatBytes32String('BAD2'),
                requests: [
                  {
                    recipient: recipient.address,
                    expirationTime,
                    data
                  }
                ]
              }
            ],
            { from: sender },
            'InvalidSchema'
          );
        });

        context('with registered schemas', () => {
          const schema1 = 'bool like';
          const schema2 = 'bytes32 proposalId, bool vote';
          const schema3 = 'bool hasPhoneNumber, bytes32 phoneHash';
          const schema1Id = getSchemaUUID(schema1, ZERO_ADDRESS, true);
          const schema2Id = getSchemaUUID(schema2, ZERO_ADDRESS, true);
          const schema3Id = getSchemaUUID(schema3, ZERO_ADDRESS, true);

          beforeEach(async () => {
            await registry.register(schema1, ZERO_ADDRESS, true);
            await registry.register(schema2, ZERO_ADDRESS, true);
            await registry.register(schema3, ZERO_ADDRESS, true);
          });

          it('should revert when multi attesting to multiple unregistered schemas', async () => {
            // Only one of the requests is to an unregistered schema
            await expectFailedMultiAttestations(
              { eas, verifier, eip712Utils },
              [
                {
                  schema: schema1Id,
                  requests: [
                    {
                      recipient: recipient.address,

                      expirationTime,
                      data
                    }
                  ]
                },
                {
                  schema: schema2Id,
                  requests: [
                    {
                      recipient: recipient.address,

                      expirationTime,
                      data
                    }
                  ]
                },
                {
                  schema: formatBytes32String('BAD'),
                  requests: [
                    {
                      recipient: recipient.address,

                      expirationTime,
                      data
                    }
                  ]
                }
              ],
              { from: sender },
              'InvalidSchema'
            );
          });

          it('should revert when attesting with passed expiration time', async () => {
            const expired = (await eas.getTime()) - duration.days(1);

            await expectFailedAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema1Id,
              {
                recipient: recipient.address,
                expirationTime: expired,
                data
              },
              { from: sender },
              'InvalidExpirationTime'
            );

            // The first request is invalid
            await expectFailedMultiAttestations(
              { eas, verifier, eip712Utils },
              [
                {
                  schema: schema1Id,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime: expired,
                      data
                    },
                    {
                      recipient: recipient.address,
                      expirationTime,
                      data
                    }
                  ]
                },
                {
                  schema: schema2Id,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime,
                      data
                    }
                  ]
                }
              ],
              { from: sender },
              'InvalidExpirationTime'
            );

            // The second request is invalid
            await expectFailedMultiAttestations(
              { eas, verifier, eip712Utils },
              [
                {
                  schema: schema1Id,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime,
                      data
                    }
                  ]
                },
                {
                  schema: schema2Id,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime,
                      data
                    },
                    {
                      recipient: recipient.address,
                      expirationTime: expired,
                      data
                    }
                  ]
                }
              ],
              { from: sender },
              'InvalidExpirationTime'
            );
          });

          it('should allow attesting to an empty recipient', async () => {
            await expectAttestation(
              { eas, verifier, eip712Utils },
              schema1Id,
              { recipient: ZERO_ADDRESS, expirationTime, data },
              { from: sender }
            );

            await expectMultiAttestations(
              { eas, verifier, eip712Utils },
              [
                {
                  schema: schema1Id,
                  requests: [
                    { recipient: ZERO_ADDRESS, expirationTime, data },
                    { recipient: ZERO_ADDRESS, expirationTime, data }
                  ]
                },
                {
                  schema: schema2Id,
                  requests: [
                    { recipient: ZERO_ADDRESS, expirationTime, data },
                    { recipient: ZERO_ADDRESS, expirationTime, data }
                  ]
                }
              ],
              { from: sender }
            );
          });

          it('should allow self attestations', async () => {
            await expectAttestation(
              { eas, verifier, eip712Utils },
              schema2Id,
              { recipient: sender.address, expirationTime, data },
              { from: sender }
            );

            await expectMultiAttestations(
              { eas, verifier, eip712Utils },
              [
                {
                  schema: schema1Id,
                  requests: [
                    { recipient: sender.address, expirationTime, data },
                    { recipient: sender.address, expirationTime, data }
                  ]
                }
              ],
              { from: sender }
            );
          });

          it('should allow multiple attestations', async () => {
            await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema1Id,
              {
                recipient: recipient.address,
                expirationTime,
                data
              },
              { from: sender }
            );

            await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema1Id,
              {
                recipient: recipient2.address,
                expirationTime,
                data
              },
              {
                from: sender
              }
            );
          });

          it('should allow multiple attestations to the same schema', async () => {
            await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema3Id,
              {
                recipient: recipient.address,
                expirationTime,
                data
              },
              {
                from: sender,
                bump: 0
              }
            );
            await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema3Id,
              {
                recipient: recipient.address,
                expirationTime,
                data
              },
              {
                from: sender,
                bump: 1
              }
            );
            await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema3Id,
              {
                recipient: recipient.address,
                expirationTime,
                data
              },
              {
                from: sender,
                bump: 2
              }
            );
          });

          it('should allow attestation without expiration time', async () => {
            await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema1Id,
              {
                recipient: recipient.address,

                expirationTime: 0,
                data
              },
              { from: sender }
            );

            await expectMultiAttestations(
              {
                eas,
                verifier,
                eip712Utils
              },
              [
                {
                  schema: schema1Id,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime: 0,
                      data
                    },
                    {
                      recipient: recipient.address,
                      expirationTime: 0,
                      data
                    }
                  ]
                }
              ],
              { from: sender }
            );
          });

          it('should allow attestation without any data', async () => {
            await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema3Id,
              {
                recipient: recipient.address,
                expirationTime
              },
              { from: sender }
            );

            await expectMultiAttestations(
              {
                eas,
                verifier,
                eip712Utils
              },
              [
                {
                  schema: schema2Id,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime
                    },
                    {
                      recipient: recipient.address,
                      expirationTime
                    }
                  ]
                }
              ],
              { from: sender }
            );
          });

          it('should store referenced attestation', async () => {
            const uuid = await getUUIDFromAttestTx(
              eas.attest({
                schema: schema1Id,
                data: {
                  recipient: recipient.address,
                  expirationTime,
                  revocable: true,
                  refUUID: ZERO_BYTES32,
                  data,
                  value: 0
                }
              })
            );

            await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema3Id,
              {
                recipient: recipient.address,
                expirationTime,
                refUUID: uuid,
                data
              },
              {
                from: sender
              }
            );

            await expectMultiAttestations(
              {
                eas,
                verifier,
                eip712Utils
              },
              [
                {
                  schema: schema1Id,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime,
                      refUUID: uuid,
                      data
                    },
                    {
                      recipient: recipient.address,
                      expirationTime,
                      refUUID: uuid,
                      data
                    }
                  ]
                }
              ],
              {
                from: sender
              }
            );
          });

          it('should generate unique UUIDs for similar attestations', async () => {
            const uuid1 = await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema3Id,
              {
                recipient: recipient.address,
                expirationTime,
                data
              },
              {
                from: sender,
                bump: 0
              }
            );
            const uuid2 = await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema3Id,
              {
                recipient: recipient.address,
                expirationTime,
                data
              },
              {
                from: sender,
                bump: 1
              }
            );
            const uuid3 = await expectAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema3Id,
              {
                recipient: recipient.address,
                expirationTime,
                data
              },
              {
                from: sender,
                bump: 2
              }
            );
            expect(uuid1).not.to.equal(uuid2);
            expect(uuid2).not.to.equal(uuid3);
          });

          it('should revert when attesting to non-existing attestations', async () => {
            await expectFailedAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schema3Id,
              {
                recipient: recipient.address,
                expirationTime,
                refUUID: formatBytes32String('INVALID'),
                data
              },
              { from: sender },
              'NotFound'
            );

            const uuid = await getUUIDFromAttestTx(
              eas.attest({
                schema: schema1Id,
                data: {
                  recipient: recipient.address,
                  expirationTime,
                  revocable: true,
                  refUUID: ZERO_BYTES32,
                  data,
                  value: 0
                }
              })
            );

            await expectFailedMultiAttestations(
              {
                eas,
                verifier,
                eip712Utils
              },
              [
                {
                  schema: schema1Id,
                  requests: [
                    { recipient: recipient.address, expirationTime, refUUID: formatBytes32String('INVALID'), data },
                    {
                      recipient: recipient.address,
                      expirationTime,
                      refUUID: uuid,
                      data
                    }
                  ]
                }
              ],
              { from: sender },
              'NotFound'
            );

            await expectFailedMultiAttestations(
              {
                eas,
                verifier,
                eip712Utils
              },
              [
                {
                  schema: schema1Id,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime,
                      refUUID: uuid,
                      data
                    },
                    { recipient: recipient.address, expirationTime, refUUID: formatBytes32String('INVALID'), data }
                  ]
                }
              ],
              { from: sender },
              'NotFound'
            );
          });

          it('should revert when attesting to empty schemas', async () => {
            await expectFailedAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              ZERO_BYTES32,
              {
                recipient: recipient.address,
                expirationTime,
                data
              },
              { from: sender },
              'InvalidSchema'
            );

            await expectFailedMultiAttestations(
              {
                eas,
                verifier,
                eip712Utils
              },
              [
                {
                  schema: ZERO_BYTES32,
                  requests: [{ recipient: recipient.address, expirationTime, data }]
                },
                {
                  schema: schema1Id,
                  requests: [{ recipient: recipient.address, expirationTime, data }]
                }
              ],
              { from: sender },
              'InvalidSchema'
            );

            await expectFailedMultiAttestations(
              {
                eas,
                verifier,
                eip712Utils
              },
              [
                {
                  schema: schema1Id,
                  requests: [{ recipient: recipient.address, expirationTime, data }]
                },
                {
                  schema: ZERO_BYTES32,
                  requests: [{ recipient: recipient.address, expirationTime, data }]
                }
              ],
              { from: sender },
              'InvalidSchema'
            );
          });
        });

        context('with an irrevocable schema', () => {
          const schema = 'bytes32 eventId,uint8 ticketType,uint32 ticketNum';
          const schemaId = getSchemaUUID(schema, ZERO_ADDRESS, false);

          beforeEach(async () => {
            await registry.register(schema, ZERO_ADDRESS, false);
          });

          it('should revert when attempting to make a revocable attestation', async () => {
            await expectFailedAttestation(
              {
                eas,
                verifier,
                eip712Utils
              },
              schemaId,
              {
                recipient: recipient.address,
                expirationTime,
                data
              },
              { from: sender },
              'Irrevocable'
            );

            await expectFailedMultiAttestations(
              {
                eas,
                verifier,
                eip712Utils
              },
              [
                {
                  schema: schemaId,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime,
                      data
                    },
                    {
                      recipient: recipient.address,
                      expirationTime,
                      revocable: false,
                      data
                    }
                  ]
                }
              ],
              { from: sender },
              'Irrevocable'
            );

            await expectFailedMultiAttestations(
              {
                eas,
                verifier,
                eip712Utils
              },
              [
                {
                  schema: schemaId,
                  requests: [
                    {
                      recipient: recipient.address,
                      expirationTime,
                      revocable: false,
                      data
                    },
                    {
                      recipient: recipient.address,
                      expirationTime,
                      data
                    }
                  ]
                }
              ],
              { from: sender },
              'Irrevocable'
            );
          });
        });
      });
    }

    it('should revert when delegation attesting with a wrong signature', async () => {
      await expect(
        eas.attestByDelegation({
          schema: formatBytes32String('BAD'),
          data: {
            recipient: recipient.address,
            expirationTime,
            revocable: true,
            refUUID: ZERO_BYTES32,
            data: ZERO_BYTES32,
            value: 0
          },
          signature: {
            v: 28,
            r: formatBytes32String('BAD'),
            s: formatBytes32String('BAD')
          },
          attester: sender.address
        })
      ).to.be.revertedWith('InvalidSignature');

      await expect(
        eas.multiAttestByDelegation([
          {
            schema: formatBytes32String('BAD'),
            data: [
              {
                recipient: recipient.address,
                expirationTime,
                revocable: true,
                refUUID: ZERO_BYTES32,
                data: ZERO_BYTES32,
                value: 0
              }
            ],
            signatures: [
              {
                v: 28,
                r: formatBytes32String('BAD'),
                s: formatBytes32String('BAD')
              }
            ],
            attester: sender.address
          }
        ])
      ).to.be.revertedWith('InvalidSignature');
    });
  });

  describe('revocation', () => {
    const schema = 'bool hasPhoneNumber, bytes32 phoneHash';
    const schemaId = getSchemaUUID(schema, ZERO_ADDRESS, true);
    let uuid: string;
    let uuids: string[] = [];

    let expirationTime: number;
    const data = '0x1234';

    beforeEach(async () => {
      await registry.register(schema, ZERO_ADDRESS, true);

      expirationTime = (await eas.getTime()) + duration.days(30);
    });

    for (const signatureType of [SignatureType.Direct, SignatureType.Delegated]) {
      context(`via ${signatureType} attestation`, () => {
        beforeEach(async () => {
          uuid = await getUUIDFromAttestTx(
            eas.connect(sender).attest({
              schema: schemaId,
              data: {
                recipient: recipient.address,
                expirationTime,
                revocable: true,
                refUUID: ZERO_BYTES32,
                data,
                value: 0
              }
            })
          );

          uuids = [];

          for (let i = 0; i < 2; i++) {
            uuids.push(
              await getUUIDFromAttestTx(
                eas.connect(sender).attest({
                  schema: schemaId,
                  data: {
                    recipient: recipient.address,
                    expirationTime,
                    revocable: true,
                    refUUID: ZERO_BYTES32,
                    data,
                    value: 0
                  }
                })
              )
            );
          }
        });

        it('should revert when revoking a non-existing attestation', async () => {
          await expectFailedRevocation(
            { eas },
            schemaId,
            { uuid: formatBytes32String('BAD') },
            { from: sender },
            'NotFound'
          );

          await expectFailedMultiRevocations(
            { eas },
            [{ schema: schemaId, requests: [{ uuid: formatBytes32String('BAD') }, { uuid }] }],
            { from: sender },
            'NotFound'
          );

          await expectFailedMultiRevocations(
            { eas },
            [{ schema: schemaId, requests: [{ uuid }, { uuid: formatBytes32String('BAD') }] }],
            { from: sender },
            'NotFound'
          );
        });

        it("should revert when revoking a someone's else attestation", async () => {
          await expectFailedRevocation({ eas }, schemaId, { uuid }, { from: sender2 }, 'AccessDenied');

          await expectFailedMultiRevocations(
            { eas },
            [{ schema: schemaId, requests: [{ uuid }, { uuid: uuids[0] }] }],
            { from: sender2 },
            'AccessDenied'
          );

          await expectFailedMultiRevocations(
            { eas },
            [{ schema: schemaId, requests: [{ uuid: uuids[1] }, { uuid }] }],
            { from: sender2 },
            'AccessDenied'
          );
        });

        it('should allow to revoke existing attestations', async () => {
          await expectRevocation({ eas }, schemaId, { uuid }, { from: sender });

          await expectMultiRevocations(
            { eas },
            [
              {
                schema: schemaId,
                requests: uuids.map((uuid) => ({ uuid }))
              }
            ],
            { from: sender }
          );
        });

        it('should revert when revoking an already revoked attestation', async () => {
          await expectRevocation({ eas }, schemaId, { uuid }, { from: sender });
          await expectFailedRevocation({ eas }, schemaId, { uuid }, { from: sender }, 'AlreadyRevoked');

          await expectFailedMultiRevocations(
            { eas },
            [{ schema: schemaId, requests: [{ uuid }, { uuid: uuids[0] }] }],
            { from: sender },
            'AlreadyRevoked'
          );

          await expectFailedMultiRevocations(
            { eas },
            [{ schema: schemaId, requests: [{ uuid: uuids[1] }, { uuid }] }],
            { from: sender },
            'AlreadyRevoked'
          );
        });

        it('should revert when attempting to revoke attestations while specifying the wrong schema', async () => {
          const schema2 = 'bool count, bytes32 id';
          const schema2Id = getSchemaUUID(schema2, ZERO_ADDRESS, true);
          await registry.register(schema2, ZERO_ADDRESS, true);

          await expectFailedRevocation({ eas }, schema2Id, { uuid }, { from: sender }, 'InvalidSchema');

          await expectFailedMultiRevocations(
            { eas },
            [
              { schema: schema2Id, requests: [{ uuid }] },
              { schema: schemaId, requests: [{ uuid: uuids[0] }] }
            ],
            { from: sender },
            'InvalidSchema'
          );

          await expectFailedMultiRevocations(
            { eas },
            [
              { schema: schemaId, requests: [{ uuid }] },
              { schema: schema2Id, requests: [{ uuid: uuids[0] }] }
            ],
            { from: sender },
            'InvalidSchema'
          );
        });

        it('should revert when attempting to revoke attestations while specifying an empty schema', async () => {
          await expectFailedRevocation({ eas }, ZERO_BYTES32, { uuid }, { from: sender }, 'InvalidSchema');

          await expectFailedMultiRevocations(
            { eas },
            [
              { schema: ZERO_BYTES32, requests: [{ uuid }] },
              { schema: schemaId, requests: [{ uuid: uuids[0] }] }
            ],
            { from: sender },
            'InvalidSchema'
          );

          await expectFailedMultiRevocations(
            { eas },
            [
              { schema: schemaId, requests: [{ uuid }] },
              { schema: ZERO_BYTES32, requests: [{ uuid: uuids[0] }] }
            ],
            { from: sender },
            'InvalidSchema'
          );
        });

        context('with irrevocable attestations', () => {
          beforeEach(async () => {
            uuid = await getUUIDFromAttestTx(
              eas.connect(sender).attest({
                schema: schemaId,
                data: {
                  recipient: recipient.address,
                  expirationTime,
                  revocable: false,
                  refUUID: ZERO_BYTES32,
                  data,
                  value: 0
                }
              })
            );

            uuids = [];

            for (let i = 0; i < 2; i++) {
              uuids.push(
                await getUUIDFromAttestTx(
                  eas.connect(sender).attest({
                    schema: schemaId,
                    data: {
                      recipient: recipient.address,
                      expirationTime,
                      revocable: false,
                      refUUID: ZERO_BYTES32,
                      data,
                      value: 0
                    }
                  })
                )
              );
            }
          });

          it('should revert when revoking', async () => {
            await expectFailedRevocation({ eas }, schemaId, { uuid }, { from: sender }, 'Irrevocable');

            await expectFailedMultiRevocations(
              { eas },
              [{ schema: schemaId, requests: [{ uuid }, { uuid: uuids[0] }] }],
              { from: sender },
              'Irrevocable'
            );

            await expectFailedMultiRevocations(
              { eas },
              [{ schema: schemaId, requests: [{ uuid: uuids[1] }, { uuid }] }],
              { from: sender },
              'Irrevocable'
            );
          });
        });

        context('with an irrevocable schema', () => {
          const schema2 = 'bool isFriend';
          const schema2Id = getSchemaUUID(schema2, ZERO_ADDRESS, false);

          beforeEach(async () => {
            await registry.register(schema2, ZERO_ADDRESS, false);

            uuid = await getUUIDFromAttestTx(
              eas.connect(sender).attest({
                schema: schema2Id,
                data: {
                  recipient: recipient.address,
                  expirationTime,
                  revocable: false,
                  refUUID: ZERO_BYTES32,
                  data,
                  value: 0
                }
              })
            );

            uuids = [];

            for (let i = 0; i < 2; i++) {
              uuids.push(
                await getUUIDFromAttestTx(
                  eas.connect(sender).attest({
                    schema: schema2Id,
                    data: {
                      recipient: recipient.address,
                      expirationTime,
                      revocable: false,
                      refUUID: ZERO_BYTES32,
                      data,
                      value: 0
                    }
                  })
                )
              );
            }
          });

          it('should revert when revoking', async () => {
            await expectFailedRevocation({ eas }, schema2Id, { uuid }, { from: sender }, 'Irrevocable');

            await expectFailedMultiRevocations(
              { eas },
              [{ schema: schema2Id, requests: [{ uuid }, { uuid: uuids[0] }] }],
              { from: sender },
              'Irrevocable'
            );

            await expectFailedMultiRevocations(
              { eas },
              [{ schema: schema2Id, requests: [{ uuid: uuids[1] }, { uuid }] }],
              { from: sender },
              'Irrevocable'
            );
          });
        });
      });
    }

    it('should revert when delegation revoking with a wrong signature', async () => {
      await expect(
        eas.revokeByDelegation({
          schema: formatBytes32String('BAD'),
          data: {
            uuid: ZERO_BYTES32,
            value: 0
          },
          signature: {
            v: 28,
            r: formatBytes32String('BAD'),
            s: formatBytes32String('BAD')
          },
          revoker: sender.address
        })
      ).to.be.revertedWith('InvalidSignature');

      await expect(
        eas.multiRevokeByDelegation([
          {
            schema: formatBytes32String('BAD'),
            data: [
              {
                uuid: ZERO_BYTES32,
                value: 0
              }
            ],
            signatures: [
              {
                v: 28,
                r: formatBytes32String('BAD'),
                s: formatBytes32String('BAD')
              }
            ],
            revoker: sender.address
          }
        ])
      ).to.be.revertedWith('InvalidSignature');
    });
  });
});
