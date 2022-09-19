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

module.exports = app;
