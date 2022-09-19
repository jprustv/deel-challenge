const express = require('express');
const Op = require('sequelize').Op;
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const contract = await Contract.findOne({
        where : {
            id,
            [Op.or] : [
                {ClientId: req.profile.id},
                {ContractorId:req.profile.id},
            ]
        },
    })
    if(!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * @returns list of user's non-terminated contracts
 */
 app.get('/contracts',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const contracts = await Contract.findAll({
        where : {
            status: {
                [Op.not] : 'terminated',
            },
            [Op.or]: [
                {ClientId: req.profile.id},
                {ContractorId:req.profile.id},
            ]
        },
    })
    if(!contracts) return res.status(404).end()
    res.json(contracts)
})

/**
 * @returns list of user's unpaid jobs
 */
 app.get('/jobs/unpaid',getProfile ,async (req, res) =>{
    const {Job, Contract} = req.app.get('models')
    const jobs = await Job.findAll({
        where : {
            paid: null,
        },
        include: [
            {
                model: Contract,
                where: {
                    status: 'in_progress',
                    [Op.or]: [
                        {ClientId: req.profile.id},
                        {ContractorId:req.profile.id},
                    ] 
                }
            }
        ]
    })
    if(!jobs) return res.status(404).end()
    res.json(jobs)
})

/**
 * @returns status of the payment operation
 */
 app.post('/jobs/:id/pay',getProfile ,async (req, res) =>{
    const {Job, Contract, Profile} = req.app.get('models');
    const {id} = req.params;
    const job = await Job.findOne({
        where : {
            paid: null,
            id,
        },
        include: {
            model: Contract,
            where: { ClientId: req.profile.id }, 
        }
    })

    if (!job) {
        return res.status(404).json({
            status: 'Error',
            message: 'This job has already been paid or doesn\'t belong to this user.',
        });
    }

    // Job exists and is pending payment, process payment now..

    if (req.profile.balance < job.price) {
        return res.status(409).json({
            status: 'Error',
            message: 'Insufficient balance to process payment',
        });
    }

    const transaction = await sequelize.transaction();

    try {
        
        const client = await Profile.findOne({
            where: {
                id: req.profile.id,
            },
            lock: true,
            transaction,
        });

        const promises = [];

        promises.push(Profile.update(
            { balance: client.balance - job.price },
            { 
                where : { 
                    id : client.id,
                    balance: {
                        [Op.gte] : job.price,
                    }
                },
                transaction,
            }
        ));

        promises.push(Profile.increment('balance', {
            by: job.price, 
            where: {
                id: job.Contract.ContractorId,
            },
            transaction,
        }));

        promises.push(Job.update(
            {
                paid: 1,
                paymentDate: new Date(),
            },
            {
                where: {
                    id: job.id,
                },
                transaction,
            }
        ));

        await Promise.all(promises);

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        res.status(409).json({
            status: 'Error',
            message: 'Unable to process payment.',
        })
    }

    res.json({
        status: 'Ok',
        message: 'Job successfully paid.',
    });
})

/**
 * @returns status of the deposit operation
 */
 app.post('/balances/deposit/:client_id/:deposit_value',getProfile ,async (req, res) =>{
    const {Job, Contract} = req.app.get('models');
    const {client_id, deposit_value} = req.params;

    if (parseInt(client_id) !== req.profile.id) {
        return res.status(400).json({
            status: 'Error',
            message: 'Cannot deposit for another client',
        });
    }

    const totalJobsPending = await Job.sum('price', {
        where: {
            paid: null,
        },
        include: {
            model: Contract,
            where: { ClientId: client_id },            
        }
    });

    const maxDepositAllowed = totalJobsPending * 0.25;

    if (parseInt(deposit_value) > maxDepositAllowed) {
        return res.status(400).json({
            status: 'Error',
            message: 'Deposit limit exceeded',
        });
    }

    req.profile.balance = req.profile.balance + parseInt(deposit_value);
    
    await req.profile.save();
    
    res.json({
        status: 'Ok',
        message: 'Balance updated.',
    });
 })

/**
 * @returns the profession that earned the most
 */
 app.get('/admin/best-profession',getProfile ,async (req, res) =>{
    const {Job, Contract, Profile} = req.app.get('models')

    const infinity = 8640000000000000;

    const {start = new Date(infinity * -1), end = new Date(infinity)} = req.query;

    const jobs = await Job.findOne({
        attributes: ['Contract.Contractor.profession' , [sequelize.fn('sum', sequelize.col('Price')), 'earnings']],
        where : {
            paid: {
                [Op.not] : null,
            },
            paymentDate: {
                [Op.between] : [start, end],
            }
        },
        include: [
            {
                model: Contract,
                required: true,
                attributes: [],
                include: [
                    {
                        model: Profile,
                        as: 'Contractor',
                        required: true,
                        attributes: [],
                    },
                ]
            },
        ],
        group : ['profession'],
        raw: true,
        order: [
            ['earnings', 'DESC'],
        ],
    });

    if (!jobs) {
        return res.status(404).json({
            status: 'Error',
            message: 'No data found',
        })
    }

    res.json(jobs);
})

module.exports = app;
