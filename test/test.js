'use strict';
const request = require('supertest');
const assert = require('assert');
const app = require('../app');
const passportStub = require('passport-stub');
const User = require('../models/user');
const Schedule = require('../models/schedule');
const Candidate = require('../models/candidate');
const Availability = require('../models/availability');
const Comment = require('../models/comment');
const deleteScheduleAggregate = require('../routes/schedules').deleteScheduleAggregate;

describe('/login', () => {
  before(() => {
    passportStub.install(app);
    passportStub.login({ username: 'testuser' });
  });

  after(() => {
    passportStub.logout();
    passportStub.uninstall(app);
  });

  it('ログインのためのリンクが含まれる', (done) => {
    request(app)
      .get('/login')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect(/<a .*?href="\/auth\/github">GitHubでログイン<\/a>/)
      .expect(200, done);
  });

  it('ログイン時はユーザー名が表示される', (done) => {
    request(app)
      .get('/')
      .expect(/testuser/)
      .expect(200, done);
  });
});

describe('/logout', () => {
  it('/ にリダイレクトされる', (done) => {
    request(app)
      .get('/logout')
      .expect('Location', '/')
      .expect(302, done);
  });
});

describe('/schedules', () => {
  before(() => {
    passportStub.install(app);
    passportStub.login({ id: 0, username: 'testuser' });
  });

  after(() => {
    passportStub.logout();
    passportStub.uninstall(app);
  });

  it('予定が作成でき、表示される（重複、空行は除外）', (done) => {
    User.upsert({ userId: 0, username: 'testuser' }).then(() => {
      request(app)
        .get('/schedules/new')
        .end((err, res) => {
          const match = res.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
          const csrf = match[1];

          request(app)
            .post('/schedules')
            .set('cookie', res.headers['set-cookie'])
            .send({ scheduleName: 'テスト予定1', memo: 'テストメモ1\r\nテストメモ2', candidates: 'テスト候補1\r\n\r\n\r\n\r\nテスト候補1\r\nテスト候補1\r\nテスト候補2\r\nテスト候補3', _csrf: csrf })
            .expect('Location', /schedules/)
            .expect(302)
            .end((err, res) => {
              const createdSchedulePath = res.headers.location;
              const regex1 = '<tr><th>テスト候補1<\/th><td><button.*?>欠<\/button><\/td><\/tr>';
              const regex2 = '<tr><th>テスト候補2<\/th><td><button.*?>欠<\/button><\/td><\/tr>';
              const regex3 = '<tr><th>テスト候補3<\/th><td><button.*?>欠<\/button><\/td><\/tr>';
              const regex = new RegExp(regex1 + regex2 + regex3);

              request(app)
                .get(createdSchedulePath)
                .expect(regex)
                .expect(200)
                .end((err, res) => { deleteScheduleAggregate(createdSchedulePath.split('/schedules/')[1], done, err); });
            });
        });
    });
  });
});

describe('/schedules/:scheduleId/users/:userId/candidates/:candidateId', () => {
  before(() => {
    passportStub.install(app);
    passportStub.login({ id: 0, username: 'testuser' });
  });

  after(() => {
    passportStub.logout();
    passportStub.uninstall(app);
  });

  it('出欠が更新できる', (done) => {
    User.upsert({ userId: 0, username: 'testuser' }).then(() => {
      request(app)
        .get('/schedules/new')
        .end((err, res) => {
          const match = res.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
          const csrf = match[1];
          request(app)
            .post('/schedules')
            .set('cookie', res.headers['set-cookie'])
            .send({ scheduleName: 'テスト出欠更新予定1', memo: 'テスト出欠更新メモ1', candidates: 'テスト出欠更新候補1', _csrf: csrf })
            .end((err, res) => {
              const createdSchedulePath = res.headers.location;
              const scheduleId = createdSchedulePath.split('/schedules/')[1];
              Candidate.findOne({
                where: { scheduleId: scheduleId }
              }).then((candidate) => {
                // 更新がされることをテスト
                request(app)
                  .post(`/schedules/${scheduleId}/users/${0}/candidates/${candidate.candidateId}`)
                  .send({ availability: 2 }) // 出席に更新
                  .expect('{"status":"OK","availability":2}')
                  .end((err, res) => {
                    Availability.findAll({
                      where: { scheduleId: scheduleId }
                    }).then((availabilities) => {
                      assert.equal(availabilities.length, 1);
                      assert.equal(availabilities[0].availability, 2);
                      deleteScheduleAggregate(scheduleId, done, err);
                    });
                  });
              });
            });
        });
    });
  });
});

describe('/schedules/:scheduleId/users/:userId/comments', () => {
  before(() => {
    passportStub.install(app);
    passportStub.login({ id: 0, username: 'testuser' });
  });

  after(() => {
    passportStub.logout();
    passportStub.uninstall(app);
  });

  it('コメントが更新できる', (done) => {
    User.upsert({ userId: 0, username: 'testuser' }).then(() => {
      request(app)
        .get('/schedules/new')
        .end((err, res) => {
          const match = res.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
          const csrf = match[1];
          request(app)
            .post('/schedules')
            .set('cookie', res.headers['set-cookie'])
            .send({ scheduleName: 'テストコメント更新予定1', memo: 'テストコメント更新メモ1', candidates: 'テストコメント更新候補1', _csrf: csrf })
            .end((err, res) => {
              const createdSchedulePath = res.headers.location;
              const scheduleId = createdSchedulePath.split('/schedules/')[1];
              // 更新がされることをテスト
              request(app)
                .post(`/schedules/${scheduleId}/users/${0}/comments`)
                .send({ comment: 'testcomment' })
                .expect('{"status":"OK","comment":"testcomment"}')
                .end((err, res) => {
                  Comment.findAll({
                    where: { scheduleId: scheduleId }
                  }).then((comments) => {
                    assert.equal(comments.length, 1);
                    assert.equal(comments[0].comment, 'testcomment');
                    deleteScheduleAggregate(scheduleId, done, err);
                  });
                });
            });
        });
    });
  });
});

describe('/schedules/:scheduleId?edit=1', () => {
  before(() => {
    passportStub.install(app);
    passportStub.login({ id: 0, username: 'testuser' });
  });

  after(() => {
    passportStub.logout();
    passportStub.uninstall(app);
  });

  it('予定が更新でき、候補が追加できる', (done) => {
    User.upsert({ userId: 0, username: 'testuser' }).then(() => {
      request(app)
        .get('/schedules/new')
        .end((err, res) => {
          const match = res.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
          const csrf = match[1];
          const setCookie = res.headers['set-cookie'];
          request(app)
            .post('/schedules')
            .set('cookie', setCookie)
            .send({ scheduleName: 'テスト更新予定1', memo: 'テスト更新メモ1', candidates: 'テスト更新候補1', _csrf: csrf })
            .end((err, res) => {
              const createdSchedulePath = res.headers.location;
              const scheduleId = createdSchedulePath.split('/schedules/')[1];
              // 更新がされることをテスト
              request(app)
                .post(`/schedules/${scheduleId}?edit=1`)
                .set('cookie', setCookie)
                .send({ scheduleName: 'テスト更新予定2', memo: 'テスト更新メモ2', candidates: 'めもめも\n3', _csrf: csrf })
                .end((err, res) => {
                  Schedule.findById(scheduleId).then((s) => {
                    assert.equal(s.scheduleName, 'テスト更新予定2');
                    assert.equal(s.memo, 'テスト更新メモ2');
                  });
                  Candidate.findAll({
                    where: { scheduleId: scheduleId }
                  }).then((candidates) => {
                    assert.equal(candidates.length, 3);
                    assert.equal(candidates[0].candidateName, 'テスト更新候補1');
                    assert.equal(candidates[1].candidateName, 'めもめも');
                    assert.equal(candidates[2].candidateName, '3');
                    deleteScheduleAggregate(scheduleId, done, err);
                  });
                });
            });
        });
    });
  });
});

describe('/schedules/:scheduleId?delete=1', () => {
  before(() => {
    passportStub.install(app);
    passportStub.login({ id: 0, username: 'testuser' });
  });

  after(() => {
    passportStub.logout();
    passportStub.uninstall(app);
  });

  it('予定に関連する全ての情報が削除できる', (done) => {
    User.upsert({ userId: 0, username: 'testuser' }).then(() => {
      request(app)
        .get('/schedules/new')
        .end((err, res) => {
          const match = res.text.match(/<input type="hidden" name="_csrf" value="(.*?)">/);
          const csrf = match[1];
          const setCookie = res.headers['set-cookie'];
          request(app)
            .post('/schedules')
            .set('cookie', setCookie)
            .send({ scheduleName: 'テスト更新予定1', memo: 'テスト更新メモ1', candidates: 'テスト更新候補1', _csrf: csrf })
            .end((err, res) => {
              const createdSchedulePath = res.headers.location;
              const scheduleId = createdSchedulePath.split('/schedules/')[1];

              // 出欠作成
              const promiseAvailability = Candidate.findOne({
                where: { scheduleId: scheduleId }
              }).then((candidate) => {
                return new Promise((resolve) => {
                  request(app)
                    .post(`/schedules/${scheduleId}/users/${0}/candidates/${candidate.candidateId}`)
                    .set('cookie', setCookie)
                    .send({ availability: 2 }) // 出席に更新
                    .end((err, res) => {
                      if (err) done(err);
                      resolve();
                    });
                });
              });

              // コメント作成
              const promiseComment = new Promise((resolve) => {
                request(app)
                  .post(`/schedules/${scheduleId}/users/${0}/comments`)
                  .set('cookie', setCookie)
                  .send({ comment: 'testcomment' })
                  .expect('{"status":"OK","comment":"testcomment"}')
                  .end((err, res) => {
                    if (err) done(err);
                    resolve();
                  });
              });

              // 削除
              const promiseDeleted = Promise.all([promiseAvailability, promiseComment]).then(() => {
                return new Promise((resolve) => {
                  request(app)
                    .post(`/schedules/${scheduleId}?delete=1`)
                    .set('cookie', setCookie)
                    .send({ _csrf: csrf })
                    .end((err, res) => {
                      if (err) done(err);
                      resolve();
                    });
                });
              });

              // テスト
              promiseDeleted.then(() => {
                const p1 = Comment.findAll({
                  where: { scheduleId: scheduleId }
                }).then((comments) => {
                  assert.equal(comments.length, 0);
                });
                const p2 = Availability.findAll({
                  where: { scheduleId: scheduleId }
                }).then((availabilities) => {
                  assert.equal(availabilities.length, 0);
                });
                const p3 = Candidate.findAll({
                  where: { scheduleId: scheduleId }
                }).then((candidates) => {
                  assert.equal(candidates.length, 0);
                });
                const p4 = Schedule.findById(scheduleId).then((schedule) => {
                  assert.equal(!schedule, true);
                });
                Promise.all([p1, p2, p3, p4]).then(() => {
                  if (err) return done(err);
                  done();
                });
              });
            });
        });
    });
  });
});
